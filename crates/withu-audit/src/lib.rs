#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditFact {
    pub schema_version: u16,
    pub operation: String,
    pub object_id: String,
    pub occurred_at: String,
    pub actor: String,
    pub result: String,
}
