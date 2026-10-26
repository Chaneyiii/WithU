//! Model-facing tool catalog for natural-language life transactions (T09/T11).
//! The model only PROPOSES one of these calls; server-side validation maps a
//! proposal onto the existing life prepare -> decide -> execute chain. Write
//! proposals stop at an approval card; read-only proposals (local retrieval,
//! content organizing) execute directly and feed a single bounded follow-up
//! model turn, mirroring what the life forms already do without approval.
use chrono::NaiveDateTime;
use chrono_tz::Tz;
use serde_json::{json, Value};

const MAX_TEXT: usize = 8192;
const MAX_TITLE: usize = 256;
const MAX_NOTES: usize = 8192;
const MAX_FIND: usize = 256;

/// What the server should do with a validated proposal.
#[derive(Debug)]
pub enum Intent {
    /// A write: mapped onto life prepare -> approval card -> decide/execute.
    Create {
        goal_description: String,
        operation: Value,
        preview_lines: Vec<String>,
    },
    /// A write against an existing item; the server resolves find_text to
    /// exactly one live item (id + expected_version come from storage, never
    /// from the model) before preparing.
    Edit {
        kind: &'static str,
        find_text: String,
        goal_description: String,
        preview_lines: Vec<String>,
        new_values: Value,
    },
    /// Read-only local retrieval; runs immediately, results feed one more
    /// model turn which must cite source and time.
    Retrieve { query: String },
    /// Read-only local content organizing; same follow-up turn as Retrieve.
    Organize { lines: Vec<String> },
    /// Web search via a configured connector or MCP (T12 stub). The server
    /// resolves the connector honestly: no configured connector yields an
    /// explicit unconfigured status, never fabricated sources.
    WebSearch { query: String },
    /// Read-only listing of the user's local reminders and calendar entries
    /// for the coming days; same bounded follow-up turn as Retrieve.
    ScheduleList,
}

impl Intent {
    pub fn read_only(&self) -> bool {
        matches!(
            self,
            Intent::Retrieve { .. }
                | Intent::Organize { .. }
                | Intent::WebSearch { .. }
                | Intent::ScheduleList
        )
    }
}

pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

/// OpenAI-compatible tool definitions. The same names/arguments are accepted
/// from anthropic tool_use and openai-responses function_call items; only the
/// transport differs (replies.rs normalizes them to name + arguments JSON).
pub fn definitions() -> Vec<Value> {
    specs()
        .into_iter()
        .map(|spec| {
            json!({
                "type":"function",
                "function":{"name":spec.name,"description":spec.description,"parameters":spec.parameters}
            })
        })
        .collect()
}

fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "create_local_reminder",
            description: "Propose creating a local reminder on this device only. Requires the reminder text and an exact due time. If the user did not state an exact time (or said something vague like \"later\"), do NOT call this tool; ask one short clarifying question instead.",
            parameters: json!({
                "type":"object",
                "properties":{
                    "text":{"type":"string","description":"Reminder text, in the user's language"},
                    "due_at_local":{"type":"string","description":"Due time as ISO 8601 local date-time without offset, e.g. 2026-10-26T15:00:00"},
                    "timezone":{"type":"string","description":"IANA timezone the due time is expressed in, e.g. Asia/Taipei. Use the user's timezone when known."}
                },
                "required":["text","due_at_local","timezone"]
            }),
        },
        ToolSpec {
            name: "edit_local_reminder",
            description: "Propose editing an existing local reminder found by matching its text. Provide find_text (a distinctive fragment of the current reminder text) plus only the fields to change. If several reminders could match, ask the user which one first.",
            parameters: json!({
                "type":"object",
                "properties":{
                    "find_text":{"type":"string","description":"Fragment of the current reminder text that uniquely identifies it"},
                    "new_text":{"type":"string","description":"New reminder text, when changing it"},
                    "new_due_at_local":{"type":"string","description":"New due time as ISO 8601 local date-time without offset, when changing it"},
                    "timezone":{"type":"string","description":"IANA timezone for new_due_at_local"}
                },
                "required":["find_text"]
            }),
        },
        ToolSpec {
            name: "delete_local_reminder",
            description: "Propose deleting an existing local reminder found by matching its text. Deletion is a local write and still requires explicit user approval.",
            parameters: json!({
                "type":"object",
                "properties":{"find_text":{"type":"string","description":"Fragment of the reminder text that uniquely identifies it"}},
                "required":["find_text"]
            }),
        },
        ToolSpec {
            name: "create_local_calendar_event",
            description: "Propose adding an event to the local calendar on this device only. Requires a title and explicit start/end times. If any required value is missing or ambiguous, ask one short clarifying question instead of guessing.",
            parameters: json!({
                "type":"object",
                "properties":{
                    "title":{"type":"string","description":"Event title, in the user's language"},
                    "starts_at_local":{"type":"string","description":"Start time as ISO 8601 local date-time without offset"},
                    "ends_at_local":{"type":"string","description":"End time as ISO 8601 local date-time without offset"},
                    "timezone":{"type":"string","description":"IANA timezone the times are expressed in"},
                    "notes":{"type":"string","description":"Optional notes, empty string when none"}
                },
                "required":["title","starts_at_local","ends_at_local","timezone"]
            }),
        },
        ToolSpec {
            name: "edit_local_calendar_event",
            description: "Propose editing an existing local calendar event found by matching its title. Provide find_text plus only the fields to change. Ambiguous matches require asking the user first.",
            parameters: json!({
                "type":"object",
                "properties":{
                    "find_text":{"type":"string","description":"Fragment of the current event title that uniquely identifies it"},
                    "new_title":{"type":"string","description":"New title, when changing it"},
                    "new_starts_at_local":{"type":"string","description":"New start time as ISO 8601 local date-time without offset"},
                    "new_ends_at_local":{"type":"string","description":"New end time as ISO 8601 local date-time without offset"},
                    "timezone":{"type":"string","description":"IANA timezone for the new times"}
                },
                "required":["find_text"]
            }),
        },
        ToolSpec {
            name: "delete_local_calendar_event",
            description: "Propose deleting an existing local calendar event found by matching its title. Requires explicit user approval.",
            parameters: json!({
                "type":"object",
                "properties":{"find_text":{"type":"string","description":"Fragment of the event title that uniquely identifies it"}},
                "required":["find_text"]
            }),
        },
        ToolSpec {
            name: "create_message_draft",
            description: "Propose saving a message draft locally. Drafts can only be created and edited; Withu never sends them. Requires the draft text.",
            parameters: json!({
                "type":"object",
                "properties":{"text":{"type":"string","description":"Draft content, in the user's language"}},
                "required":["text"]
            }),
        },
        ToolSpec {
            name: "edit_message_draft",
            description: "Propose editing an existing message draft found by matching its text. Drafts are never sent. Requires find_text and the full new text.",
            parameters: json!({
                "type":"object",
                "properties":{
                    "find_text":{"type":"string","description":"Fragment of the current draft that uniquely identifies it"},
                    "new_text":{"type":"string","description":"The complete new draft content"}
                },
                "required":["find_text","new_text"]
            }),
        },
        ToolSpec {
            name: "discard_message_draft",
            description: "Propose discarding an existing message draft found by matching its text. Requires explicit user approval.",
            parameters: json!({
                "type":"object",
                "properties":{"find_text":{"type":"string","description":"Fragment of the draft that uniquely identifies it"}},
                "required":["find_text"]
            }),
        },
        ToolSpec {
            name: "retrieve_local_information",
            description: "Search the user's locally stored sources (imported files and local information the app already holds) for a query. Read-only; results are returned with source references and times.",
            parameters: json!({
                "type":"object",
                "properties":{"query":{"type":"string","description":"Search query in the user's language"}},
                "required":["query"]
            }),
        },
        ToolSpec {
            name: "organize_local_content",
            description: "Organize user-supplied lines of content into grouped local summaries. Read-only computation; nothing is sent anywhere.",
            parameters: json!({
                "type":"object",
                "properties":{"lines":{"type":"array","items":{"type":"string"},"description":"The lines of content to organize, exactly as the user gave them","minItems":1,"maxItems":100}},
                "required":["lines"]
            }),
        },
        ToolSpec {
            name: "search_web_information",
            description: "Search the web through the user's configured search connector. Results carry source titles, links and retrieval times. If no web connector is configured the tool returns an explicit unconfigured status — tell the user honestly and offer local retrieval instead of inventing results.",
            parameters: json!({
                "type":"object",
                "properties":{"query":{"type":"string","description":"Search query in the user's language"}},
                "required":["query"]
            }),
        },
        ToolSpec {
            name: "list_my_schedule",
            description: "List the user's own local reminders and calendar entries for today and the coming days, sorted by time. Read-only; never sends or modifies anything. Use it when the user asks what is on their schedule.",
            parameters: json!({
                "type":"object",
                "properties":{}
            }),
        },
    ]
}

pub fn recognizes(name: &str) -> bool {
    specs().iter().any(|spec| spec.name == name)
}

/// Validate a proposed tool call. Unconfirmed or malformed input never
/// becomes tool parameters: every field is re-typed, re-bounded and
/// timezone-converted here regardless of what the model emitted.
pub fn map(
    name: &str,
    arguments: &Value,
    conversation_id: &str,
    now: u64,
) -> Result<Intent, (&'static str, &'static str)> {
    let object = arguments
        .as_object()
        .ok_or(("validation", "tool_arguments_object"))?;
    // (allowed fields, required fields): edit tools accept optional patches,
    // but every present key must be declared and every required key present.
    let (allowed, required): (Vec<&str>, Vec<&str>) = match name {
        "create_local_reminder" => (
            vec!["text", "due_at_local", "timezone"],
            vec!["text", "due_at_local", "timezone"],
        ),
        "edit_local_reminder" => (
            vec!["find_text", "new_text", "new_due_at_local", "timezone"],
            vec!["find_text"],
        ),
        "delete_local_reminder" => (vec!["find_text"], vec!["find_text"]),
        "create_local_calendar_event" => (
            vec![
                "title",
                "starts_at_local",
                "ends_at_local",
                "timezone",
                "notes",
            ],
            vec!["title", "starts_at_local", "ends_at_local", "timezone"],
        ),
        "edit_local_calendar_event" => (
            vec![
                "find_text",
                "new_title",
                "new_starts_at_local",
                "new_ends_at_local",
                "timezone",
            ],
            vec!["find_text"],
        ),
        "delete_local_calendar_event" => (vec!["find_text"], vec!["find_text"]),
        "create_message_draft" => (vec!["text"], vec!["text"]),
        "edit_message_draft" => (vec!["find_text", "new_text"], vec!["find_text", "new_text"]),
        "discard_message_draft" => (vec!["find_text"], vec!["find_text"]),
        "retrieve_local_information" => (vec!["query"], vec!["query"]),
        "organize_local_content" => (vec!["lines"], vec!["lines"]),
        "search_web_information" => (vec!["query"], vec!["query"]),
        "list_my_schedule" => (vec![], vec![]),
        _ => return Err(("validation", "tool_unknown")),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || !required.iter().all(|key| object.contains_key(*key))
    {
        return Err(("validation", "tool_arguments_fields"));
    }
    let id = format!("chat-{}", uuid::Uuid::new_v4());
    let tz = |value: Option<&Value>| -> Result<Tz, (&'static str, &'static str)> {
        value
            .and_then(|value| value.as_str())
            .and_then(|name| name.parse::<Tz>().ok())
            .ok_or(("validation", "tool_timezone"))
    };
    let text = |value: &Value, limit: usize| -> Result<String, (&'static str, &'static str)> {
        value
            .as_str()
            .map(str::to_owned)
            .filter(|text| !text.trim().is_empty() && text.chars().count() <= limit)
            .ok_or(("validation", "tool_text"))
    };
    let find =
        || -> Result<String, (&'static str, &'static str)> { text(&object["find_text"], MAX_FIND) };
    match name {
        "create_local_reminder" => {
            let text = text(&object["text"], MAX_TEXT)?;
            let timezone = tz(object.get("timezone"))?;
            let (due_at, display) = local_time(&object["due_at_local"], timezone)?;
            if due_at <= now {
                return Err(("validation", "tool_due_in_past"));
            }
            Ok(Intent::Create {
                goal_description: "Create a local reminder".into(),
                operation: json!({"kind":"reminder_create","id":id,"text":text,"due_at":due_at,"timezone":timezone.name()}),
                preview_lines: vec![text, format!("due {display}")],
            })
        }
        "edit_local_reminder" => {
            let find_text = find()?;
            let timezone = match object.get("new_due_at_local") {
                Some(_) => Some(tz(object.get("timezone"))?),
                None => None,
            };
            let due_at: Option<(u64, String)> = match (object.get("new_due_at_local"), timezone) {
                (Some(_), Some(tz)) => Some(local_time(&object["new_due_at_local"], tz)?),
                _ => None,
            };
            let new_text = object
                .get("new_text")
                .map(|v| text(v, MAX_TEXT))
                .transpose()?;
            if new_text.is_none() && due_at.is_none() {
                return Err(("validation", "tool_edit_empty"));
            }
            let mut preview = vec![format!("匹配提醒：{find_text}")];
            if let Some(text) = &new_text {
                preview.push(format!("新内容：{}", text));
            }
            if let Some((_, display)) = &due_at {
                preview.push(format!("新时间：{display}"));
            }
            Ok(Intent::Edit {
                kind: "reminder",
                find_text,
                goal_description: "Edit a local reminder".into(),
                preview_lines: preview,
                new_values: json!({
                    "text": new_text,
                    "due_at": due_at.map(|(unix, _)| unix),
                    "timezone": timezone.map(|tz| tz.name()),
                }),
            })
        }
        "delete_local_reminder" => Ok(Intent::Edit {
            kind: "reminder",
            find_text: find()?,
            goal_description: "Delete a local reminder".into(),
            preview_lines: vec![format!("删除提醒：{}", find()?)],
            new_values: Value::Null,
        }),
        "create_local_calendar_event" => {
            let title = text(&object["title"], MAX_TITLE)?;
            let timezone = tz(object.get("timezone"))?;
            let (starts_at, start_display) = local_time(&object["starts_at_local"], timezone)?;
            let (ends_at, end_display) = local_time(&object["ends_at_local"], timezone)?;
            let notes = object
                .get("notes")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(MAX_NOTES)
                .collect::<String>();
            if ends_at <= starts_at {
                return Err(("validation", "tool_time_range"));
            }
            Ok(Intent::Create {
                goal_description: "Add a local calendar event".into(),
                operation: json!({"kind":"calendar_create","id":id,"title":title,"starts_at":starts_at,"ends_at":ends_at,"timezone":timezone.name(),"notes":notes}),
                preview_lines: vec![title, format!("{start_display} — {end_display}")],
            })
        }
        "edit_local_calendar_event" => {
            let find_text = find()?;
            let timezone = match object
                .get("new_starts_at_local")
                .or_else(|| object.get("new_ends_at_local"))
            {
                Some(_) => Some(tz(object.get("timezone"))?),
                None => None,
            };
            let start = match (object.get("new_starts_at_local"), timezone) {
                (Some(_), Some(tz)) => Some(local_time(&object["new_starts_at_local"], tz)?),
                _ => None,
            };
            let end = match (object.get("new_ends_at_local"), timezone) {
                (Some(_), Some(tz)) => Some(local_time(&object["new_ends_at_local"], tz)?),
                _ => None,
            };
            let new_title = object
                .get("new_title")
                .map(|v| text(v, MAX_TITLE))
                .transpose()?;
            if new_title.is_none() && start.is_none() && end.is_none() {
                return Err(("validation", "tool_edit_empty"));
            }
            if let (Some((start_unix, _)), Some((end_unix, _))) = (&start, &end) {
                if end_unix <= start_unix {
                    return Err(("validation", "tool_time_range"));
                }
            }
            let mut preview = vec![format!("匹配日程：{find_text}")];
            if let Some(title) = &new_title {
                preview.push(format!("新标题：{}", title));
            }
            if let Some((_, display)) = &start {
                preview.push(format!("新开始：{display}"));
            }
            if let Some((_, display)) = &end {
                preview.push(format!("新结束：{display}"));
            }
            Ok(Intent::Edit {
                kind: "calendar",
                find_text,
                goal_description: "Edit a local calendar event".into(),
                preview_lines: preview,
                new_values: json!({
                    "title": new_title,
                    "starts_at": start.map(|(unix, _)| unix),
                    "ends_at": end.map(|(unix, _)| unix),
                    "timezone": timezone.map(|tz| tz.name()),
                }),
            })
        }
        "delete_local_calendar_event" => Ok(Intent::Edit {
            kind: "calendar",
            find_text: find()?,
            goal_description: "Delete a local calendar event".into(),
            preview_lines: vec![format!("删除日程：{}", find()?)],
            new_values: Value::Null,
        }),
        "create_message_draft" => {
            let text = text(&object["text"], MAX_TEXT)?;
            Ok(Intent::Create {
                goal_description: "Save a local message draft".into(),
                operation: json!({"kind":"draft_create","id":id,"conversation_id":conversation_id,"text":text,"file_refs":[]}),
                preview_lines: vec![text],
            })
        }
        "edit_message_draft" => {
            let find_text = find()?;
            let new_text = text(&object["new_text"], MAX_TEXT)?;
            Ok(Intent::Edit {
                kind: "draft",
                goal_description: "Edit a local message draft".into(),
                preview_lines: vec![
                    format!("匹配草稿：{find_text}"),
                    format!("新内容：{}", new_text),
                ],
                find_text,
                new_values: json!({"text": new_text}),
            })
        }
        "discard_message_draft" => Ok(Intent::Edit {
            kind: "draft",
            find_text: find()?,
            goal_description: "Discard a local message draft".into(),
            preview_lines: vec![format!("丢弃草稿：{}", find()?)],
            new_values: Value::Null,
        }),
        "retrieve_local_information" => {
            let query = text(&object["query"], 256)?;
            Ok(Intent::Retrieve { query })
        }
        "organize_local_content" => {
            let lines = object["lines"]
                .as_array()
                .ok_or(("validation", "tool_arguments_fields"))?;
            if lines.is_empty() || lines.len() > 100 {
                return Err(("validation", "tool_arguments_fields"));
            }
            let lines = lines
                .iter()
                .map(|line| {
                    line.as_str()
                        .filter(|line| !line.trim().is_empty())
                        .map(str::to_owned)
                        .ok_or(("validation", "tool_text"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Intent::Organize { lines })
        }
        "search_web_information" => {
            let query = text(&object["query"], 256)?;
            Ok(Intent::WebSearch { query })
        }
        "list_my_schedule" => Ok(Intent::ScheduleList),
        _ => Err(("validation", "tool_unknown")),
    }
}

/// Parse a local wall-clock timestamp in a named IANA zone. Offsets, dates
/// without a time, and DST-ambiguous or nonexistent local times are refused,
/// so a wrong-zone proposal cannot silently shift the stored instant.
fn local_time(value: &Value, timezone: Tz) -> Result<(u64, String), (&'static str, &'static str)> {
    let raw = value
        .as_str()
        .filter(|raw| raw.len() <= 40)
        .ok_or(("validation", "tool_time_format"))?;
    let raw = raw.trim();
    let naive = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]
    .iter()
    .find_map(|format| NaiveDateTime::parse_from_str(raw, format).ok())
    .ok_or(("validation", "tool_time_format"))?;
    let local = naive
        .and_local_timezone(timezone)
        .single()
        .ok_or(("validation", "tool_time_format"))?;
    let unix = local.timestamp();
    if unix < 0 {
        return Err(("validation", "tool_time_format"));
    }
    Ok((unix as u64, local.format("%Y-%m-%d %H:%M %Z").to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_mapping_validates_and_converts() {
        let args = json!({"text":"团队周会","due_at_local":"2026-10-26T15:00:00","timezone":"Asia/Taipei"});
        let Intent::Create {
            operation,
            preview_lines,
            ..
        } = map("create_local_reminder", &args, "c1", 1_000_000).unwrap()
        else {
            panic!("create intent")
        };
        assert_eq!(operation["kind"], "reminder_create");
        // 2026-10-26 15:00 Taipei == 07:00 UTC
        assert_eq!(operation["due_at"], 1_792_998_000u64);
        assert_eq!(preview_lines[1], "due 2026-10-26 15:00 CST");
    }

    #[test]
    fn unknown_tool_and_missing_fields_rejected() {
        assert_eq!(
            map("send_email", &json!({}), "c1", 1).unwrap_err().1,
            "tool_unknown"
        );
        assert_eq!(
            map("create_local_reminder", &json!({"text":"x"}), "c1", 1)
                .unwrap_err()
                .1,
            "tool_arguments_fields"
        );
        assert_eq!(
            map(
                "create_local_reminder",
                &json!({"text":"x","due_at_local":"2026-10-26","timezone":"UTC","extra":true}),
                "c1",
                1
            )
            .unwrap_err()
            .1,
            "tool_arguments_fields"
        );
        // Edit without any change is rejected.
        assert_eq!(
            map("edit_local_reminder", &json!({"find_text":"周会"}), "c1", 1)
                .unwrap_err()
                .1,
            "tool_edit_empty"
        );
    }

    #[test]
    fn time_parsing_accepts_wall_clock_only() {
        let args = |time: &str| json!({"text":"x","due_at_local":time,"timezone":"UTC"});
        assert!(map("create_local_reminder", &args("2026-10-26 15:00"), "c1", 1).is_ok());
        assert!(map(
            "create_local_reminder",
            &args("2026-10-26T15:00:00"),
            "c1",
            1
        )
        .is_ok());
        for bad in [
            "2026-10-26T15:00:00+08:00",
            "2026-10-26T15:00:00Z",
            "2026-10-26",
            "2026-13-01T00:00",
            "2026-02-30T00:00",
            "2026-10-26T25:00",
            "not-a-time",
        ] {
            assert_eq!(
                map("create_local_reminder", &args(bad), "c1", 1)
                    .unwrap_err()
                    .1,
                "tool_time_format",
                "rejected {bad}"
            );
        }
    }

    #[test]
    fn unknown_timezone_rejected() {
        let args = json!({"text":"x","due_at_local":"2026-10-26T15:00","timezone":"Mars/Olympus"});
        assert_eq!(
            map("create_local_reminder", &args, "c1", 1).unwrap_err().1,
            "tool_timezone"
        );
    }

    #[test]
    fn past_due_and_reversed_range_rejected() {
        let past = json!({"text":"x","due_at_local":"2000-01-01T00:00","timezone":"UTC"});
        assert_eq!(
            map("create_local_reminder", &past, "c1", 1_800_000_000)
                .unwrap_err()
                .1,
            "tool_due_in_past"
        );
        let range = json!({"title":"t","starts_at_local":"2026-10-26T10:00","ends_at_local":"2026-10-26T09:00","timezone":"UTC"});
        assert_eq!(
            map("create_local_calendar_event", &range, "c1", 1)
                .unwrap_err()
                .1,
            "tool_time_range"
        );
    }

    #[test]
    fn draft_maps_into_current_conversation() {
        let Intent::Create { operation, .. } = map(
            "create_message_draft",
            &json!({"text":"帮我想好的一段话"}),
            "conversation-9",
            1,
        )
        .unwrap() else {
            panic!("create intent")
        };
        assert_eq!(operation["conversation_id"], "conversation-9");
        assert_eq!(operation["kind"], "draft_create");
    }

    #[test]
    fn edit_tools_never_accept_versions_or_ids_from_the_model() {
        // An injected expected_version is an unknown field and fails closed;
        // edit intents carry only a find_text and new values — ids and
        // versions are resolved from storage by the server.
        assert_eq!(
            map(
                "edit_local_reminder",
                &json!({"find_text":"周会","new_text":"周会（改期）","expected_version":7}),
                "c1",
                1,
            )
            .unwrap_err()
            .1,
            "tool_arguments_fields"
        );
        let Intent::Edit {
            kind,
            find_text,
            new_values,
            ..
        } = map(
            "edit_local_reminder",
            &json!({"find_text":"周会","new_text":"周会（改期）"}),
            "c1",
            1,
        )
        .unwrap()
        else {
            panic!("edit intent")
        };
        assert_eq!(kind, "reminder");
        assert_eq!(find_text, "周会");
        assert_eq!(new_values["text"], "周会（改期）");
        assert!(new_values.get("expected_version").is_none());
    }

    #[test]
    fn definitions_only_expose_local_tools() {
        let definitions = definitions();
        let names: Vec<&str> = definitions
            .iter()
            .filter_map(|d| d["function"]["name"].as_str())
            .collect();
        assert_eq!(
            names,
            vec![
                "create_local_reminder",
                "edit_local_reminder",
                "delete_local_reminder",
                "create_local_calendar_event",
                "edit_local_calendar_event",
                "delete_local_calendar_event",
                "create_message_draft",
                "edit_message_draft",
                "discard_message_draft",
                "retrieve_local_information",
                "organize_local_content",
                "search_web_information",
                "list_my_schedule",
            ]
        );
        assert!(recognizes("retrieve_local_information"));
        assert!(recognizes("list_my_schedule"));
        assert!(!recognizes("delete_file"));
    }

    #[test]
    fn retrieve_and_organize_are_read_only() {
        let retrieve = map(
            "retrieve_local_information",
            &json!({"query":"会议纪要"}),
            "c1",
            1,
        )
        .unwrap();
        assert!(retrieve.read_only());
        let organize = map(
            "organize_local_content",
            &json!({"lines":["a","b"]}),
            "c1",
            1,
        )
        .unwrap();
        assert!(organize.read_only());
        let create = map("create_message_draft", &json!({"text":"x"}), "c1", 1).unwrap();
        assert!(!create.read_only());
        assert_eq!(
            map("organize_local_content", &json!({"lines":[]}), "c1", 1)
                .unwrap_err()
                .1,
            "tool_arguments_fields"
        );
    }
}
