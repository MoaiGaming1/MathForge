use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
pub struct EngineRequest {
    pub id: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
}

impl EngineRequest {
    fn new(operation: &str, expression: Option<String>) -> Self {
        Self {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed).to_string(),
            operation: operation.into(),
            expression,
        }
    }
    pub fn health() -> Self {
        Self::new("health", None)
    }
    pub fn simplify(expression: String) -> Self {
        Self::new("symbolic.simplify", Some(expression))
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EngineResponse {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<EngineError>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}
