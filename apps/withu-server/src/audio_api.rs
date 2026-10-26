//! Cloud audio transport shared by probes and explicit finite Chat voice operations.
//! Model/voice are user-selected; no model catalog, capability inference or fallback.
//! Official contracts: developers.openai.com/api/docs/guides/{speech-to-text,text-to-speech}
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use zeroize::Zeroizing;

pub const INPUT_RATE: u32 = 16_000;
pub const OUTPUT_RATE: u32 = 24_000;
const MAX_INPUT: usize = INPUT_RATE as usize * 60;
const MAX_AUDIO_BYTES: usize = OUTPUT_RATE as usize * 2 * 120;
const FRAME_SAMPLES: usize = 3_200;
pub type Result<T> = std::result::Result<T, &'static str>;

pub struct AudioApi {
    endpoint: String,
    model: String,
    key: Zeroizing<Vec<u8>>,
    client: reqwest::Client,
}
impl AudioApi {
    pub fn new(endpoint: String, model: String, key: Zeroizing<Vec<u8>>) -> Result<Self> {
        let url = url::Url::parse(&endpoint).map_err(|_| "endpoint_invalid")?;
        if endpoint.len() > 2048
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
            || (url.scheme() != "https"
                && !(url.scheme() == "http"
                    && ["127.0.0.1", "localhost", "[::1]"].contains(&url.host_str().unwrap_or(""))))
        {
            return Err("endpoint_invalid");
        }
        if model.trim().is_empty() || model.len() > 256 || model.contains(['\r', '\n', '\0']) {
            return Err("model_id_invalid");
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "http_client_failed")?;
        let api = Self {
            endpoint,
            model,
            key,
            client,
        };
        api.auth()?;
        Ok(api)
    }
    fn auth(&self) -> Result<reqwest::header::HeaderValue> {
        let key = std::str::from_utf8(&self.key).map_err(|_| "credential_invalid")?;
        if key.is_empty() {
            return Err("credential_missing");
        }
        let raw = Zeroizing::new(format!("Bearer {key}"));
        let mut header =
            reqwest::header::HeaderValue::from_str(&raw).map_err(|_| "credential_invalid")?;
        header.set_sensitive(true);
        Ok(header)
    }
    fn url(&self, path: &str) -> String {
        format!("{}/audio/{path}", self.endpoint.trim_end_matches('/'))
    }
    // Finite audio/explicit utterance boundary; not claimed to be duplex realtime ASR.
    // Audio exists only in memory; no temporary file, automatic retry or logging.
    pub async fn transcribe(&self, samples: &[i16]) -> Result<String> {
        let wav = wav(samples)?;
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("utterance.wav")
            .mime_str("audio/wav")
            .map_err(|_| "audio_format_invalid")?;
        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .part("file", part);
        let response = self
            .client
            .post(self.url("transcriptions"))
            .header(reqwest::header::AUTHORIZATION, self.auth()?)
            .multipart(form)
            .send()
            .await
            .map_err(transport)?;
        status(&response)?;
        if !mime(&response).starts_with("application/json") {
            return Err("asr_protocol_invalid");
        }
        let bytes = bounded(response, 256_000).await?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "asr_protocol_invalid")?;
        let text = value["text"].as_str().ok_or("asr_protocol_invalid")?;
        if text.len() > 64_000 {
            return Err("transcript_limit");
        }
        if text.contains(std::str::from_utf8(&self.key).map_err(|_| "credential_invalid")?) {
            return Err("sensitive_provider_output");
        }
        if text.trim().is_empty() {
            return Err("asr_empty");
        }
        Ok(text.to_owned())
    }
    // Provider PCM is signed little-endian 16-bit at 24kHz, NOT the existing
    // 16kHz speech fixture rate. Consumer must preserve or explicitly resample.
    // Dropping this future closes the actual HTTP stream; caller owns generation
    // filtering and must stop already queued playback immediately on cancellation.
    pub async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        mut emit: impl FnMut(u64, u32, &[i16]) -> Result<()>,
    ) -> Result<()> {
        if text.trim().is_empty() || text.len() > 16_000 {
            return Err("tts_text_invalid");
        }
        if voice.trim().is_empty() || voice.len() > 128 || voice.contains(['\r', '\n', '\0']) {
            return Err("voice_id_invalid");
        }
        let response = self
            .client
            .post(self.url("speech"))
            .header(reqwest::header::AUTHORIZATION, self.auth()?)
            .json(&json!({"model":self.model,"input":text,"voice":voice,"response_format":"pcm"}))
            .send()
            .await
            .map_err(transport)?;
        status(&response)?;
        if matches!(
            mime(&response).split(';').next().unwrap_or("").trim(),
            "audio/wav" | "audio/x-wav" | "audio/wave"
        ) {
            let bytes = bounded(response, 4_000_000).await?;
            let (rate, samples) = crate::provider_tools::wav_pcm(&bytes)?;
            return emit(1, rate, &samples);
        }
        if !matches!(
            mime(&response).split(';').next().unwrap_or("").trim(),
            "audio/pcm" | "audio/raw" | "application/octet-stream"
        ) {
            return Err("tts_protocol_invalid");
        }
        let mut stream = response.bytes_stream();
        let mut pending = Vec::new();
        let mut total = 0;
        let mut seq = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(transport)?;
            total += chunk.len();
            if total > MAX_AUDIO_BYTES {
                return Err("audio_response_limit");
            }
            pending.extend_from_slice(&chunk);
            while pending.len() >= FRAME_SAMPLES * 2 {
                let samples = pcm(&pending[..FRAME_SAMPLES * 2]);
                seq += 1;
                emit(seq, OUTPUT_RATE, &samples)?;
                pending.drain(..FRAME_SAMPLES * 2);
            }
        }
        if total == 0 || pending.len() % 2 != 0 {
            return Err("tts_audio_incomplete");
        }
        if !pending.is_empty() {
            seq += 1;
            emit(seq, OUTPUT_RATE, &pcm(&pending))?;
        }
        Ok(())
    }
}
fn transport(error: reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "request_timeout"
    } else {
        "service_unavailable"
    }
}
fn status(response: &reqwest::Response) -> Result<()> {
    match response.status().as_u16() {
        200 => Ok(()),
        401 | 403 => Err("auth_failed"),
        404 | 422 => Err("model_unsupported"),
        429 => Err("rate_limited"),
        _ => Err("service_unavailable"),
    }
}
fn mime(response: &reqwest::Response) -> &str {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}
async fn bounded(response: reqwest::Response, limit: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(transport)?;
        if bytes.len() + chunk.len() > limit {
            return Err("response_limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn pcm(bytes: &[u8]) -> Vec<i16> {
    bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect()
}
fn wav(samples: &[i16]) -> Result<Vec<u8>> {
    if samples.is_empty() || samples.len() > MAX_INPUT {
        return Err("audio_input_limit");
    }
    let length = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(length as usize + 44);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + length).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&INPUT_RATE.to_le_bytes());
    bytes.extend_from_slice(&(INPUT_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&length.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    const KEY: &str = "FICTIONAL-AUDIO-WIRE-KEY";
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn request(socket: &mut TcpStream) -> Vec<u8> {
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut data = vec![];
        let mut buf = [0; 4096];
        loop {
            let n = socket.read(&mut buf).unwrap();
            assert!(n > 0);
            data.extend_from_slice(&buf[..n]);
            if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&data[..end]).to_lowercase();
                let size = headers
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("content-length:")
                            .map(|n| n.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                if data.len() >= end + 4 + size {
                    return data;
                }
            }
        }
    }
    fn fixture(
        status: u16,
        mime: &str,
        chunks: Vec<Vec<u8>>,
    ) -> (AudioApi, std::thread::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let mime = mime.to_owned();
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let data = request(&mut socket);
            write!(socket,"HTTP/1.1 {status} Fixture\r\nContent-Type: {mime}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
            for chunk in chunks {
                if write!(socket, "{:x}\r\n", chunk.len()).is_err()
                    || socket.write_all(&chunk).is_err()
                    || socket.write_all(b"\r\n").is_err()
                {
                    return data;
                }
            }
            let _ = socket.write_all(b"0\r\n\r\n");
            data
        });
        (
            AudioApi::new(
                endpoint,
                "user-selected-model".into(),
                Zeroizing::new(KEY.as_bytes().to_vec()),
            )
            .unwrap(),
            thread,
        )
    }
    #[test]
    fn wav_header_and_input_boundary() {
        let bytes = wav(&[-32768, 0, 32767]).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            INPUT_RATE
        );
        assert_eq!(&bytes[44..], [0, 128, 0, 0, 255, 127]);
        assert_eq!(wav(&[]), Err("audio_input_limit"));
        assert_eq!(wav(&vec![0; MAX_INPUT + 1]), Err("audio_input_limit"));
        for endpoint in [
            "http://example.com/v1",
            "https://u:p@example.com/v1",
            "https://example.com/v1?key=x",
            "https://example.com/#x",
        ] {
            assert!(AudioApi::new(
                endpoint.into(),
                "m".into(),
                Zeroizing::new(KEY.as_bytes().to_vec())
            )
            .is_err());
        }
    }
    #[test]
    fn actual_multipart_transcription_and_secret_output_rejection() {
        let rt = runtime();
        let (api, peer) = fixture(
            200,
            "application/json",
            vec![br#"{"text":"actual fixture transcript"}"#.to_vec()],
        );
        assert_eq!(
            rt.block_on(api.transcribe(&[0, 100, -100])).unwrap(),
            "actual fixture transcript"
        );
        let bytes = peer.join().unwrap();
        let data = String::from_utf8_lossy(&bytes);
        assert!(data.starts_with("POST /v1/audio/transcriptions "));
        assert!(data.contains("authorization: Bearer FICTIONAL-AUDIO-WIRE-KEY"));
        assert!(data.contains("multipart/form-data; boundary="));
        assert!(data.contains("name=\"model\""));
        assert!(data.contains("user-selected-model"));
        assert!(data.contains("filename=\"utterance.wav\""));
        assert!(bytes.windows(4).any(|w| w == b"RIFF"));
        for (body, code) in [
            (json!({"text":KEY}), "sensitive_provider_output"),
            (json!({"text":" "}), "asr_empty"),
            (json!({"unexpected":"no text"}), "asr_protocol_invalid"),
        ] {
            let (api, peer) = fixture(200, "application/json", vec![body.to_string().into_bytes()]);
            assert_eq!(rt.block_on(api.transcribe(&[1])), Err(code));
            peer.join().unwrap();
        }
    }
    #[test]
    fn actual_tts_fragmented_pcm_preserves_rate_samples_and_voice() {
        let rt = runtime();
        let original = (0..6501).map(|n| (n - 3250) as i16).collect::<Vec<_>>();
        let bytes = original
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect::<Vec<_>>();
        // Odd HTTP chunks must not split or lose a PCM sample.
        let (api, peer) = fixture(
            200,
            "audio/pcm",
            bytes.chunks(913).map(|b| b.to_vec()).collect(),
        );
        let mut frames = vec![];
        let mut decoded = vec![];
        rt.block_on(
            api.synthesize("User text", "user-voice", |seq, rate, samples| {
                frames.push(seq);
                assert_eq!(rate, OUTPUT_RATE);
                decoded.extend_from_slice(samples);
                Ok(())
            }),
        )
        .unwrap();
        assert_eq!(frames, vec![1, 2, 3]);
        assert_eq!(decoded, original);
        let request = peer.join().unwrap();
        let end = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let body: Value = serde_json::from_slice(&request[end + 4..]).unwrap();
        assert_eq!(
            body,
            json!({"model":"user-selected-model","input":"User text","voice":"user-voice","response_format":"pcm"})
        );
        assert!(!String::from_utf8_lossy(&request[end + 4..]).contains(KEY));
    }
    #[test]
    fn audio_failures_do_not_retry_or_expose_provider_error_bodies() {
        let rt = runtime();
        for (status, code) in [
            (401, "auth_failed"),
            (403, "auth_failed"),
            (429, "rate_limited"),
            (422, "model_unsupported"),
            (503, "service_unavailable"),
            (302, "service_unavailable"),
        ] {
            let (api, peer) = fixture(status, "application/json", vec![KEY.as_bytes().to_vec()]);
            assert_eq!(rt.block_on(api.transcribe(&[1])), Err(code));
            peer.join().unwrap();
        }
        for (mime, chunks, code) in [
            (
                "application/json",
                vec![b"error".to_vec()],
                "tts_protocol_invalid",
            ),
            ("audio/pcm", vec![], "tts_audio_incomplete"),
            ("audio/pcm", vec![vec![1, 2, 3]], "tts_audio_incomplete"),
        ] {
            let (api, peer) = fixture(200, mime, chunks);
            assert_eq!(
                rt.block_on(api.synthesize("text", "voice", |_, _, _| Ok(()))),
                Err(code)
            );
            peer.join().unwrap();
        }
        let (api, peer) = fixture(200, "application/json", vec![vec![b'x'; 256001]]);
        assert_eq!(rt.block_on(api.transcribe(&[1])), Err("response_limit"));
        peer.join().unwrap();
    }
    #[test]
    fn dropping_tts_future_closes_actual_network_stream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let peer = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            request(&mut socket);
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: audio/pcm\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n\0\0\r\n").unwrap();
            // No terminal chunk: cancellation must close this hanging stream.
            let mut byte = [0];
            match socket.read(&mut byte) {
                Ok(0) => true,
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                    ) =>
                {
                    true
                }
                _ => false,
            }
        });
        let api = AudioApi::new(
            endpoint,
            "model".into(),
            Zeroizing::new(KEY.as_bytes().to_vec()),
        )
        .unwrap();
        assert!(runtime()
            .block_on(async {
                tokio::time::timeout(
                    Duration::from_millis(200),
                    api.synthesize("text", "voice", |_, _, _| Ok(())),
                )
                .await
            })
            .is_err());
        assert!(
            peer.join().unwrap(),
            "dropping future must close HTTP socket, not just hide output"
        );
    }
}
