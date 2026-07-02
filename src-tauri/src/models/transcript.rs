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
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "sentenceId")]
    pub sentence_id: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "wordIds")]
    pub word_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptResult {
    pub text: String,
    pub chunks: Vec<SubtitleChunk>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "wordChunks")]
    pub word_chunks: Option<Vec<SubtitleChunk>>,
    #[serde(default)]
    #[serde(rename = "hasWordTimestamps")]
    pub has_word_timestamps: bool,
    pub language: String,
    pub duration: f64,
}