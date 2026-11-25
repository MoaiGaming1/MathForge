use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

pub const NOTEBOOK_FORMAT: &str = "mathforge";
pub const NOTEBOOK_FORMAT_VERSION: u32 = 1;
pub const MAX_NOTEBOOK_BYTES: usize = 16 * 1024 * 1024;
const MAX_CELLS: usize = 5_000;
const MAX_CELL_CONTENT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookDocument {
    pub format: String,
    pub format_version: u32,
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub modified_at: String,
    #[serde(default)]
    pub settings: NotebookSettings,
    #[serde(default)]
    pub cells: Vec<NotebookCell>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSettings {
    pub auto_calculate: bool,
    pub calculation_debounce_ms: u32,
}

impl Default for NotebookSettings {
    fn default() -> Self {
        Self {
            auto_calculate: true,
            calculation_debounce_ms: 450,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookCell {
    pub id: String,
    pub order: u32,
    pub cell_type: CellType,
    pub content: String,
    #[serde(default)]
    pub result: Option<CellResult>,
    #[serde(default)]
    pub visualization: VisualizationSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisualizationSettings {
    #[serde(default)]
    pub mode: DisplayMode,
    #[serde(default)]
    pub result: ResultDisplaySettings,
    #[serde(default)]
    pub graph2d: Graph2DSettings,
    #[serde(default)]
    pub complex_plane: ComplexPlaneSettings,
    #[serde(default)]
    pub graph3d: Graph3DSettings,
}

impl Default for VisualizationSettings {
    fn default() -> Self {
        Self { mode: DisplayMode::Result, result: ResultDisplaySettings::default(), graph2d: Graph2DSettings::default(), complex_plane: ComplexPlaneSettings::default(), graph3d: Graph3DSettings::default() }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DisplayMode { #[default] Result, Graph2d, ComplexPlane, Graph3d }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultDisplaySettings { #[serde(default = "default_precision")] pub precision: u8 }
impl Default for ResultDisplaySettings { fn default() -> Self { Self { precision: default_precision() } } }
fn default_precision() -> u8 { 30 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Graph2DSettings {
    #[serde(default = "default_x_range")] pub x_range: [f64; 2],
    #[serde(default = "default_y_range")] pub y_range: [f64; 2],
    #[serde(default = "default_samples")] pub samples: u16,
    #[serde(default = "default_color")] pub color: String,
}
impl Default for Graph2DSettings { fn default() -> Self { Self { x_range: default_x_range(), y_range: default_y_range(), samples: default_samples(), color: default_color() } } }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComplexPlaneSettings {
    #[serde(default = "default_x_range")] pub real_range: [f64; 2],
    #[serde(default = "default_y_range")] pub imaginary_range: [f64; 2],
    #[serde(default = "default_precision")] pub precision: u8,
    #[serde(default = "default_color")] pub color: String,
}
impl Default for ComplexPlaneSettings { fn default() -> Self { Self { real_range: default_x_range(), imaginary_range: default_y_range(), precision: default_precision(), color: default_color() } } }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Graph3DSettings {
    #[serde(default = "default_x_range")] pub x_range: [f64; 2],
    #[serde(default = "default_x_range")] pub y_range: [f64; 2],
    #[serde(default = "default_y_range")] pub z_range: [f64; 2],
    #[serde(default = "default_resolution")] pub resolution: u8,
    #[serde(default = "default_parameter_range")] pub parameter_range: [f64; 2],
    #[serde(default = "default_color")] pub color: String,
    #[serde(default)] pub camera: CameraSettings,
}
impl Default for Graph3DSettings { fn default() -> Self { Self { x_range: default_x_range(), y_range: default_x_range(), z_range: default_y_range(), resolution: default_resolution(), parameter_range: default_parameter_range(), color: default_color(), camera: CameraSettings::default() } } }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraSettings { #[serde(default)] pub rotation: [f64; 2], #[serde(default = "default_zoom")] pub zoom: f64, #[serde(default)] pub pan: [f64; 2] }
impl Default for CameraSettings { fn default() -> Self { Self { rotation: [0.75, 0.6], zoom: 1.0, pan: [0.0, 0.0] } } }

fn default_x_range() -> [f64; 2] { [-10.0, 10.0] }
fn default_y_range() -> [f64; 2] { [-10.0, 10.0] }
fn default_samples() -> u16 { 401 }
fn default_resolution() -> u8 { 24 }
fn default_parameter_range() -> [f64; 2] { [0.0, 6.283185307179586] }
fn default_color() -> String { "#a8cb82".to_string() }
fn default_zoom() -> f64 { 1.0 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CellType {
    Mathematics,
    Text,
    Markdown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellResult {
    pub exact: String,
    pub latex: String,
    pub calculated_at: String,
    #[serde(default)]
    pub approximate: bool,
    #[serde(default)]
    pub warning: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookSummary {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub file_location: String,
    pub created_at: String,
    pub modified_at: String,
    pub last_opened_at: Option<String>,
    pub favorite: bool,
    pub missing: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookFolder {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub recovered: Vec<String>,
    pub missing: Vec<String>,
    pub invalid: Vec<RecoveryProblem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryProblem {
    pub file: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub notebooks: Vec<NotebookSummary>,
    pub folders: Vec<NotebookFolder>,
    pub recovery: RecoveryReport,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReceipt {
    pub revision: u64,
    pub modified_at: String,
    pub stale: bool,
}

impl NotebookDocument {
    pub fn new(title: String) -> Self {
        let now = now_rfc3339();
        Self {
            format: NOTEBOOK_FORMAT.to_string(),
            format_version: NOTEBOOK_FORMAT_VERSION,
            id: Uuid::new_v4().to_string(),
            title,
            created_at: now.clone(),
            modified_at: now,
            settings: NotebookSettings::default(),
            cells: Vec::new(),
        }
    }

    pub fn validate(&mut self) -> Result<(), String> {
        if self.format != NOTEBOOK_FORMAT {
            return Err("This is not a MathForge notebook file.".to_string());
        }
        if self.format_version != NOTEBOOK_FORMAT_VERSION {
            return Err(format!(
                "Unsupported MathForge notebook format version: {}.",
                self.format_version
            ));
        }
        self.id = canonical_id(&self.id)?;
        self.title = validate_title(&self.title)?;
        validate_timestamp(&self.created_at, "createdAt")?;
        validate_timestamp(&self.modified_at, "modifiedAt")?;
        if !(100..=5_000).contains(&self.settings.calculation_debounce_ms) {
            return Err("Calculation debounce must be between 100 and 5000 ms.".to_string());
        }
        if self.cells.len() > MAX_CELLS {
            return Err(format!("A notebook may contain at most {MAX_CELLS} cells."));
        }
        let mut ids = std::collections::HashSet::with_capacity(self.cells.len());
        for cell in &mut self.cells {
            cell.id = canonical_id(&cell.id)?;
            if !ids.insert(cell.id.clone()) {
                return Err(format!("Duplicate notebook cell ID: {}.", cell.id));
            }
            if cell.content.len() > MAX_CELL_CONTENT_BYTES {
                return Err("A cell's content exceeds the 1 MiB limit.".to_string());
            }
            if let Some(result) = &cell.result {
                if result.exact.len() > MAX_CELL_CONTENT_BYTES
                    || result.latex.len() > MAX_CELL_CONTENT_BYTES
                    || result.warning.as_ref().is_some_and(|warning| warning.len() > 2_000)
                {
                    return Err("A saved cell result exceeds the 1 MiB limit.".to_string());
                }
                validate_timestamp(&result.calculated_at, "cell result calculatedAt")?;
            }
            cell.visualization.validate()?;
        }
        self.cells.sort_by_key(|cell| cell.order);
        for (expected, cell) in self.cells.iter_mut().enumerate() {
            if cell.order as usize != expected {
                return Err(
                    "Cell order values must be unique and contiguous from zero.".to_string()
                );
            }
        }
        Ok(())
    }
}

impl VisualizationSettings {
    fn validate(&self) -> Result<(), String> {
        if !(10..=100).contains(&self.result.precision) { return Err("Result precision must be between 10 and 100 digits.".to_string()); }
        validate_range(self.graph2d.x_range, "2D x range")?;
        validate_range(self.graph2d.y_range, "2D y range")?;
        if !(40..=1000).contains(&self.graph2d.samples) { return Err("2D graph sampling must be between 40 and 1000 points.".to_string()); }
        validate_color(&self.graph2d.color)?;
        validate_range(self.complex_plane.real_range, "Complex plane real range")?;
        validate_range(self.complex_plane.imaginary_range, "Complex plane imaginary range")?;
        if !(10..=100).contains(&self.complex_plane.precision) { return Err("Complex-plane precision must be between 10 and 100 digits.".to_string()); }
        validate_color(&self.complex_plane.color)?;
        validate_range(self.graph3d.x_range, "3D x range")?;
        validate_range(self.graph3d.y_range, "3D y range")?;
        validate_range(self.graph3d.z_range, "3D z range")?;
        if !(8..=48).contains(&self.graph3d.resolution) { return Err("3D sampling resolution must be between 8 and 48.".to_string()); }
        validate_range(self.graph3d.parameter_range, "3D parameter range")?;
        validate_color(&self.graph3d.color)?;
        if !self.graph3d.camera.rotation.iter().all(|value| value.is_finite()) || !self.graph3d.camera.pan.iter().all(|value| value.is_finite() && (-4.0..=4.0).contains(value)) || !self.graph3d.camera.zoom.is_finite() || !(0.25..=8.0).contains(&self.graph3d.camera.zoom) {
            return Err("3D camera settings are outside the supported range.".to_string());
        }
        Ok(())
    }
}

fn validate_range(range: [f64; 2], label: &str) -> Result<(), String> {
    if !range.iter().all(|value| value.is_finite() && (-1_000_000.0..=1_000_000.0).contains(value)) || range[0] >= range[1] {
        return Err(format!("{label} must be finite, ordered, and within ±1,000,000."));
    }
    Ok(())
}

fn validate_color(color: &str) -> Result<(), String> {
    if color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Visualization colors must be six-digit hexadecimal values.".to_string());
    }
    Ok(())
}

pub fn validate_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A title cannot be empty.".to_string());
    }
    if title.chars().count() > 120 {
        return Err("A title may not exceed 120 characters.".to_string());
    }
    if title.chars().any(char::is_control) {
        return Err("A title cannot contain control characters.".to_string());
    }
    Ok(title.to_string())
}

pub fn canonical_id(id: &str) -> Result<String, String> {
    Uuid::parse_str(id)
        .map(|uuid| uuid.to_string())
        .map_err(|_| "Notebook and cell IDs must be valid UUIDs.".to_string())
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("formatting an RFC3339 timestamp should not fail")
}

fn validate_timestamp(value: &str, field: &str) -> Result<(), String> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|_| ())
        .map_err(|_| format!("{field} must be an RFC 3339 timestamp."))
}

#[cfg(test)]
mod visualization_tests {
    use super::*;

    #[test]
    fn older_notebook_cells_receive_default_visualization_settings() {
        let mut document = NotebookDocument::new("Legacy".to_string());
        document.cells.push(NotebookCell { id: Uuid::new_v4().to_string(), order: 0, cell_type: CellType::Mathematics, content: "x".to_string(), result: None, visualization: VisualizationSettings::default() });
        let mut value = serde_json::to_value(document).unwrap();
        value["cells"][0].as_object_mut().unwrap().remove("visualization");
        value["cells"][0]["result"] = serde_json::json!({"exact":"0.5","latex":"0.5","calculatedAt":now_rfc3339()});
        let loaded: NotebookDocument = serde_json::from_value(value).unwrap();
        assert_eq!(loaded.cells[0].visualization, VisualizationSettings::default());
        assert!(!loaded.cells[0].result.as_ref().unwrap().approximate);
    }

    #[test]
    fn visualization_settings_are_validated_and_round_trip() {
        let mut document = NotebookDocument::new("Views".to_string());
        document.cells.push(NotebookCell { id: Uuid::new_v4().to_string(), order: 0, cell_type: CellType::Mathematics, content: "x".to_string(), result: None, visualization: VisualizationSettings::default() });
        let view = &mut document.cells[0].visualization;
        view.mode = DisplayMode::Graph3d;
        view.graph3d.camera.pan = [0.4, -0.3];
        view.graph3d.camera.zoom = 1.7;
        view.graph2d.x_range = [-3.0, 7.0];
        document.validate().unwrap();
        let serialized = serde_json::to_string(&document).unwrap();
        let restored: NotebookDocument = serde_json::from_str(&serialized).unwrap();
        assert_eq!(restored.cells[0].visualization, document.cells[0].visualization);

        document.cells[0].visualization.graph2d.x_range = [4.0, 4.0];
        assert!(document.validate().unwrap_err().contains("2D x range"));
    }
}
