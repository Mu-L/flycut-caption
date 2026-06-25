use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleChunk {
    pub id: String,
    pub text: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub second_text: Option<String>,
    pub timestamp: [f64; 2],
    #[serde(default)]
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptResult {
    pub text: String,
    pub chunks: Vec<SubtitleChunk>,
    pub language: String,
    pub duration: f64,
}
