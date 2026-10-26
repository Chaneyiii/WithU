//! Explicit user-triggered discovery/probes. No private audio or conversation input.
use crate::{audio_api::AudioApi, replies::Snapshot};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use serde_json::{json, Value};
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, &'static str>;
const PROBE_WAV: &[u8] = include_bytes!("../assets/asr-probe.wav");
#[cfg(test)]
pub const PROBE_TEXT: &str = "Hello. This is a speech recognition test.";
pub fn is_mimo(endpoint: &str) -> bool {
    url::Url::parse(endpoint).ok().is_some_and(|u| {
        u.host_str() == Some("api.xiaomimimo.com") && u.path().trim_end_matches('/') == "/v1"
    })
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "http_client_failed")
}
fn auth(snapshot: &Snapshot) -> Result<reqwest::header::HeaderValue> {
    let key = std::str::from_utf8(&snapshot.key).map_err(|_| "credential_invalid")?;
    if key.is_empty() {
        return Err("credential_missing");
    }
    let raw = Zeroizing::new(
        if matches!(snapshot.protocol.as_str(), "anthropic" | "azure") {
            key.to_string()
        } else {
            format!("Bearer {key}")
        },
    );
    let mut header =
        reqwest::header::HeaderValue::from_str(&raw).map_err(|_| "credential_invalid")?;
    header.set_sensitive(true);
    Ok(header)
}
async fn body(response: reqwest::Response, limit: usize) -> Result<Zeroizing<Vec<u8>>> {
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("auth_failed"),
        404 | 405 | 422 => return Err("model_unsupported"),
        429 => return Err("rate_limited"),
        _ => return Err("service_unavailable"),
    }
    let mut bytes = Zeroizing::new(Vec::new());
    let mut stream = response.bytes_stream();
    while let Some(part) = stream.next().await {
        let part = part.map_err(|_| "service_unavailable")?;
        if bytes.len() + part.len() > limit {
            return Err("response_limit");
        };
        bytes.extend_from_slice(&part)
    }
    Ok(bytes)
}
async fn json_response(response: reqwest::Response, key: &[u8], limit: usize) -> Result<Value> {
    let bytes = body(response, limit).await?;
    let key = std::str::from_utf8(key).map_err(|_| "credential_invalid")?;
    if !key.is_empty() && String::from_utf8_lossy(&bytes).contains(key) {
        return Err("sensitive_provider_output");
    }
    serde_json::from_slice(&bytes).map_err(|_| "provider_protocol_invalid")
}
pub async fn models(snapshot: Snapshot) -> Result<String> {
    if snapshot.protocol == "bedrock" {
        return crate::bedrock::models(snapshot).await;
    }
    let c = client()?;
    let url = format!("{}/models", snapshot.endpoint.trim_end_matches('/'));
    let mut request = c.get(url);
    if snapshot.protocol == "anthropic" {
        request = request
            .header("x-api-key", auth(&snapshot)?)
            .header("anthropic-version", "2023-06-01");
    } else if snapshot.protocol == "azure" {
        request = request.header("api-key", auth(&snapshot)?);
    } else {
        request = request.header(reqwest::header::AUTHORIZATION, auth(&snapshot)?);
    }
    let response = request.send().await.map_err(|_| "service_unavailable")?;
    let value = json_response(response, &snapshot.key, 1_000_000).await?;
    let data = value["data"].as_array().ok_or("models_protocol_invalid")?;
    if data.len() > 2000 {
        return Err("models_limit");
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut items = Vec::new();
    for item in data {
        let id = item["id"].as_str().ok_or("models_protocol_invalid")?;
        if id.trim().is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
            return Err("models_protocol_invalid");
        }
        if ids.insert(id.to_owned()) {
            let kind = if is_mimo(&snapshot.endpoint) {
                match id {
                    "mimo-v2.5-asr" => Some("asr"),
                    "mimo-v2.5-tts" => Some("tts"),
                    "mimo-v2.5-tts-voiceclone" | "mimo-v2.5-tts-voicedesign" => {
                        Some("advanced-tts")
                    }
                    _ => None,
                }
            } else {
                None
            };
            items.push(json!({"id":id,"kind":kind}));
        }
    }
    Ok(json!({"items":items,"partial":value["has_more"]==true,"source":"provider","capabilities_verified":false}).to_string())
}
pub async fn audio_probe(snapshot: Snapshot, kind: &str, voice: &str) -> Result<String> {
    // Endpoint/protocol alone never establishes audio support; the actual typed
    // response must validate. Native Messages is not OpenAI's Audio API.
    if is_mimo(&snapshot.endpoint) {
        return mimo_probe(snapshot, kind, voice).await;
    }
    if snapshot.protocol == "anthropic" {
        return Err("speech_protocol_unsupported");
    }
    let api = AudioApi::new(snapshot.endpoint, snapshot.model, snapshot.key)?;
    if kind == "asr" {
        let samples = wav_pcm(PROBE_WAV)?.1;
        let text = api.transcribe(&samples).await?;
        check_transcript(&text)?;
        return Ok(json!({"sample_verified":true}).to_string());
    }
    if voice.trim().is_empty() {
        return Err("voice_id_invalid");
    }
    let mut sample_rate = 24000;
    let mut samples = Vec::new();
    api.synthesize(
        "Hello. This is Withu's voice test.",
        voice,
        |_, rate, frame| {
            if samples.len() + frame.len() > rate as usize * 10
                || samples.len() + frame.len() > 240000
            {
                return Err("audio_response_limit");
            }
            sample_rate = rate;
            samples.extend_from_slice(frame);
            Ok(())
        },
    )
    .await?;
    Ok(audio_result(sample_rate, &samples)?.to_string())
}
async fn mimo_probe(snapshot: Snapshot, kind: &str, voice: &str) -> Result<String> {
    let result = mimo_voice(
        snapshot,
        kind,
        voice,
        &STANDARD.encode(PROBE_WAV),
        "Hello. This is Withu's voice test.",
    )
    .await?;
    if kind == "asr" {
        check_transcript(&result)?;
        Ok(json!({"sample_verified":true}).to_string())
    } else {
        Ok(result)
    }
}
async fn mimo_voice(
    snapshot: Snapshot,
    kind: &str,
    voice: &str,
    wav: &str,
    text: &str,
) -> Result<String> {
    let request_body = if kind == "asr" {
        if snapshot.model != "mimo-v2.5-asr" {
            return Err("model_task_mismatch");
        }
        json!({"model":snapshot.model,"stream":false,"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":wav,"format":"wav"}}]}]})
    } else {
        if snapshot.model != "mimo-v2.5-tts" {
            return Err("model_task_mismatch");
        }
        if ![
            "mimo_default",
            "冰糖",
            "茉莉",
            "苏打",
            "白桦",
            "Mia",
            "Chloe",
            "Milo",
            "Dean",
        ]
        .contains(&voice)
        {
            return Err("voice_id_invalid");
        }
        json!({"model":snapshot.model,"stream":false,"messages":[{"role":"assistant","content":text}],"audio":{"format":"wav","voice":voice}})
    };
    let response = client()?
        .post(format!(
            "{}/chat/completions",
            snapshot.endpoint.trim_end_matches('/')
        ))
        .header(reqwest::header::AUTHORIZATION, auth(&snapshot)?)
        .json(&request_body)
        .send()
        .await
        .map_err(|_| "service_unavailable")?;
    let value = json_response(response, &snapshot.key, 1_000_000).await?;
    if value["choices"][0]["finish_reason"] != "stop" {
        return Err("stream_incomplete");
    }
    if kind == "asr" {
        let text = value["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("asr_protocol_invalid")?;
        if text.is_empty() || text.len() > 64000 {
            return Err("asr_protocol_invalid");
        }
        Ok(text.to_owned())
    } else {
        let encoded = value["choices"][0]["message"]["audio"]["data"]
            .as_str()
            .ok_or("tts_protocol_invalid")?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "tts_protocol_invalid")?;
        let (rate, samples) = wav_pcm(&bytes)?;
        Ok(audio_result(rate, &samples)?.to_string())
    }
}
fn check_transcript(text: &str) -> Result<()> {
    let normalized = text
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>();
    if normalized.contains("hello") && normalized.contains("speechrecognitiontest") {
        Ok(())
    } else {
        Err("asr_sample_mismatch")
    }
}
fn audio_result(rate: u32, samples: &[i16]) -> Result<Value> {
    if samples.is_empty()
        || samples.iter().all(|s| *s == 0)
        || samples.len() > rate as usize * 10
        || samples.len() > 240_000
    {
        return Err("tts_audio_incomplete");
    }
    let pcm = samples
        .iter()
        .flat_map(|s| s.to_le_bytes())
        .collect::<Vec<_>>();
    Ok(
        json!({"audio_base64":STANDARD.encode(pcm),"sample_rate":rate,"channels":1,"format":"pcm16le","duration_ms":samples.len()*1000/rate as usize}),
    )
}
pub fn wav_pcm(bytes: &[u8]) -> Result<(u32, Vec<i16>)> {
    if bytes.len() < 44
        || bytes.len() > 4_000_000
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err("audio_format_invalid");
    }
    let mut at = 12;
    let mut format = None;
    let mut data = None;
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let start = at + 8;
        let end = start
            .checked_add(size)
            .filter(|e| *e <= bytes.len())
            .ok_or("audio_format_invalid")?;
        match &bytes[at..at + 4] {
            b"fmt " => {
                if size < 16 {
                    return Err("audio_format_invalid");
                }
                let u16at =
                    |i| u16::from_le_bytes(bytes[start + i..start + i + 2].try_into().unwrap());
                let mut tag = u16at(0);
                let channels = u16at(2) as usize;
                let rate = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
                let bits = u16at(14) as usize;
                let align = u16at(12) as usize;
                if tag == 65534 {
                    if size < 40
                        || u16at(16) < 22
                        || bytes[start + 26..start + 40]
                            != [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]
                    {
                        return Err("audio_format_invalid");
                    }
                    tag = u16at(24);
                }
                if !(8000..=96000).contains(&rate)
                    || !(1..=2).contains(&channels)
                    || !((tag == 1 && [8, 16, 24, 32].contains(&bits)) || (tag == 3 && bits == 32))
                    || align != channels * bits / 8
                {
                    return Err("audio_format_invalid");
                }
                format = Some((tag, channels, rate, bits, align));
            }
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        at = end + size % 2;
    }
    let (tag, channels, rate, bits, align) = format.ok_or("audio_format_invalid")?;
    let data = data.ok_or("audio_format_invalid")?;
    if data.is_empty() || data.len() % align != 0 {
        return Err("audio_format_invalid");
    }
    if data.len() / align > rate as usize * 10 || data.len() / align > 240000 {
        return Err("audio_response_limit");
    }
    let mut pcm = Vec::with_capacity(data.len() / align);
    for frame in data.chunks_exact(align) {
        let mut sum = 0.0;
        for b in frame.chunks_exact(bits / 8) {
            let x = match (tag, bits) {
                (3, 32) => f32::from_le_bytes(b.try_into().unwrap()) as f64,
                (1, 8) => (b[0] as f64 - 128.0) / 128.0,
                (1, 16) => i16::from_le_bytes(b.try_into().unwrap()) as f64 / 32768.0,
                (1, 24) => {
                    ((i32::from_le_bytes([b[0], b[1], b[2], 0]) << 8) >> 8) as f64 / 8388608.0
                }
                (1, 32) => i32::from_le_bytes(b.try_into().unwrap()) as f64 / 2147483648.0,
                _ => return Err("audio_format_invalid"),
            };
            if !x.is_finite() {
                return Err("audio_format_invalid");
            }
            sum += x;
        }
        pcm.push(((sum / channels as f64).clamp(-1.0, 1.0) * 32767.0).round() as i16);
    }
    Ok((rate, pcm))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(value: Value) -> (Snapshot, std::thread::JoinHandle<Value>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 8192];
            let (end, size) = loop {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(i) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                    let end = i + 4;
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let size = headers
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap();
                    assert!(headers.starts_with("post /v1/chat/completions "));
                    assert!(headers.contains("authorization: bearer fictional-mimo-only"));
                    if bytes.len() >= end + size {
                        break (end, size);
                    }
                }
            };
            let body: Value = serde_json::from_slice(&bytes[end..end + size]).unwrap();
            let text = value.to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",text.len(),text).unwrap();
            body
        });
        (
            Snapshot {
                provider: "fixture".into(),
                protocol: "openai-compatible".into(),
                endpoint,
                model: "mimo-v2.5-asr".into(),
                reasoning_effort: None,
                key: Zeroizing::new(b"FICTIONAL-MIMO-ONLY".to_vec()),
                messages: vec![],
                tools: vec![],
            },
            thread,
        )
    }
    #[test]
    fn actual_mimo_asr_json_wire() {
        let (s, peer) =
            fixture(json!({"choices":[{"finish_reason":"stop","message":{"content":PROBE_TEXT}}]}));
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(rt.block_on(mimo_probe(s, "asr", "")).is_ok());
        let request = peer.join().unwrap();
        assert_eq!(request["model"], "mimo-v2.5-asr");
        assert_eq!(request["stream"], false);
        assert_eq!(
            STANDARD
                .decode(
                    request["messages"][0]["content"][0]["input_audio"]["data"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            PROBE_WAV
        );
        assert_eq!(
            request["messages"][0]["content"][0]["input_audio"]["format"],
            "wav"
        );
    }
    #[test]
    fn actual_mimo_tts_json_wire() {
        let (mut s, peer) = fixture(
            json!({"choices":[{"finish_reason":"stop","message":{"audio":{"data":STANDARD.encode(PROBE_WAV)}}}]}),
        );
        s.model = "mimo-v2.5-tts".into();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result: Value =
            serde_json::from_str(&rt.block_on(mimo_probe(s, "tts", "Mia")).unwrap()).unwrap();
        assert_eq!(result["sample_rate"], 16000);
        let request = peer.join().unwrap();
        assert_eq!(request["model"], "mimo-v2.5-tts");
        assert_eq!(request["audio"]["voice"], "Mia");
        assert_eq!(request["audio"]["format"], "wav");
        assert_eq!(request["messages"][0]["role"], "assistant");
        let snapshot = Snapshot {
            provider: "p".into(),
            protocol: "openai-compatible".into(),
            endpoint: "http://127.0.0.1:9/v1".into(),
            model: "mimo-v2.5-asr".into(),
            reasoning_effort: None,
            key: Zeroizing::new(b"k".to_vec()),
            messages: vec![],
            tools: vec![],
        };
        assert_eq!(
            rt.block_on(mimo_probe(snapshot, "tts", "Mia")),
            Err("model_task_mismatch")
        );
    }
    #[test]
    fn wav_stereo_float_22050_and_malformed() {
        let mut b = vec![0u8; 52];
        b[..4].copy_from_slice(b"RIFF");
        b[4..8].copy_from_slice(&44u32.to_le_bytes());
        b[8..12].copy_from_slice(b"WAVE");
        b[12..16].copy_from_slice(b"fmt ");
        b[16..20].copy_from_slice(&16u32.to_le_bytes());
        b[20..22].copy_from_slice(&3u16.to_le_bytes());
        b[22..24].copy_from_slice(&2u16.to_le_bytes());
        b[24..28].copy_from_slice(&22050u32.to_le_bytes());
        b[28..32].copy_from_slice(&176400u32.to_le_bytes());
        b[32..34].copy_from_slice(&8u16.to_le_bytes());
        b[34..36].copy_from_slice(&32u16.to_le_bytes());
        b[36..40].copy_from_slice(b"data");
        b[40..44].copy_from_slice(&8u32.to_le_bytes());
        b[44..48].copy_from_slice(&0.5f32.to_le_bytes());
        b[48..52].copy_from_slice(&0.25f32.to_le_bytes());
        let (rate, pcm) = wav_pcm(&b).unwrap();
        assert_eq!(rate, 22050);
        assert_eq!(pcm.len(), 1);
        assert_eq!(pcm[0], 12288);
        b[44..48].copy_from_slice(&f32::NAN.to_le_bytes());
        assert_eq!(wav_pcm(&b), Err("audio_format_invalid"));
    }
    #[test]
    fn known_probe_wav_and_transcript() {
        let (rate, pcm) = wav_pcm(PROBE_WAV).unwrap();
        assert_eq!(rate, 16_000);
        assert!(!pcm.is_empty());
        check_transcript(PROBE_TEXT).unwrap();
        assert!(check_transcript("unrelated").is_err());
        assert!(wav_pcm(b"not audio").is_err());
        assert!(!is_mimo("https://api.xiaomimimo.com.evil.example/v1"));
        assert!(is_mimo("https://api.xiaomimimo.com/v1"));
    }
}
