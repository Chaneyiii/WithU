//! Explicit, offline test data writer. Never called by the production server.
use std::path::PathBuf;
use withu_memory::{
    EvidenceRecord, EvidenceVersion, MemoryKind, MemoryRecord, PersistentMemoryStore,
};

fn main() -> Result<(), withu_storage::StoreError> {
    let mut args = std::env::args().skip(1);
    assert_eq!(args.next().as_deref(), Some("--test-fixture"));
    let root = PathBuf::from(args.next().expect("isolated data directory"));
    assert!(
        root.join("D3_TEST_FIXTURE").is_file(),
        "fixture marker required"
    );
    let mut store = PersistentMemoryStore::open(&root.join("withu-state-v1.sqlite"))?;
    if args.next().as_deref() == Some("--inspect") {
        println!(
            "{}",
            serde_json::to_string(&store.export()?).expect("serialize fixture export")
        );
        return Ok(());
    }
    assert_eq!(store.state_version()?, 0, "refuse to seed existing memory");
    for (scope, suffix, subject, content) in [
        ("comfort", "tea", "茶饮偏好 · fixture", "我喜欢无糖乌龙茶。"),
        (
            "comfort",
            "walk",
            "散步习惯 · fixture",
            "我喜欢傍晚在河边散步。",
        ),
        (
            "cowork:fixture",
            "work",
            "工作范围 · fixture",
            "这是另一个作用域的隔离测试数据。",
        ),
    ] {
        let evidence_id = format!("fixture-evidence-{suffix}");
        let record = MemoryRecord {
            schema_version: 1,
            id: format!("fixture-memory-{suffix}"),
            kind: MemoryKind::ExplicitPreference,
            subject: subject.into(),
            content: content.into(),
            observed_at: "2026-10-16T00:00:00Z".into(),
            confidence: 1.0,
            valid_from: "2026-10-16".into(),
            valid_to: None,
            status: "active".into(),
            version: 1,
            confirmed: true,
            save_permission: true,
            source_evidence: vec![EvidenceVersion {
                id: evidence_id.clone(),
                version: 1,
            }],
        };
        store.save_memory_with_evidence(
            EvidenceRecord {
                schema_version: 1,
                id: evidence_id.clone(),
                scope: scope.into(),
                turn_id: format!("fixture-turn-{suffix}"),
                speaker: "user".into(),
                captured_at: "2026-10-16T00:00:00Z".into(),
                text_excerpt: content.into(),
                text_ref: format!("fixture://{suffix}"),
                redaction: "synthetic-test-fixture".into(),
                deleted_at: None,
                version: 1,
            },
            record.clone(),
            true,
            0,
            store.state_version()?,
        )?;
        if suffix == "tea" {
            let mut shared = record;
            shared.id = "fixture-memory-shared".into();
            shared.subject = "共同来源 · fixture".into();
            store.save_memory(scope, shared, 0, store.state_version()?)?;
            store.add_reference_cache(
                scope,
                "fixture-cache",
                vec![EvidenceVersion {
                    id: evidence_id,
                    version: 1,
                }],
                store.state_version()?,
            )?;
            store.add_reference_cache(
                scope,
                "fixture-cache-child",
                vec![EvidenceVersion {
                    id: "fixture-cache".into(),
                    version: 1,
                }],
                store.state_version()?,
            )?;
        }
    }
    println!("D3_TEST_FIXTURE seeded {}", root.display());
    Ok(())
}
