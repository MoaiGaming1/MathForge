use crate::protocol::{EngineRequest, EngineResponse};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct Engine {
    child: Option<Child>,
    input: Option<BufWriter<ChildStdin>>,
    output: Option<BufReader<ChildStdout>>,
    startup_error: Option<String>,
}

impl Engine {
    pub fn new() -> Self {
        match Self::spawn() {
            Ok((child, input, output)) => Self {
                child: Some(child),
                input: Some(input),
                output: Some(output),
                startup_error: None,
            },
            Err(error) => Self {
                child: None,
                input: None,
                output: None,
                startup_error: Some(error),
            },
        }
    }

    fn spawn() -> Result<(Child, BufWriter<ChildStdin>, BufReader<ChildStdout>), String> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_dir = manifest
            .parent()
            .ok_or("Could not determine the MathForge project directory")?;
        let engine_dir = match std::env::var_os("MATHFORGE_ENGINE_DIR") {
            Some(path) => absolute_from_project(project_dir, PathBuf::from(path)),
            None => project_dir.join("engine"),
        };
        let python = python_executable(project_dir);
        let mut child = Command::new(python)
            .args(["-X", "utf8", "-u", "-m", "mathforge_engine"])
            .current_dir(engine_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("Could not start the Python engine: {error}"))?;
        let input = child
            .stdin
            .take()
            .ok_or("Python engine stdin was unavailable")?;
        let output = child
            .stdout
            .take()
            .ok_or("Python engine stdout was unavailable")?;
        Ok((child, BufWriter::new(input), BufReader::new(output)))
    }

    pub fn request(&mut self, request: EngineRequest) -> Result<EngineResponse, String> {
        if self
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok())
            .flatten()
            .is_some()
        {
            self.child = None;
            self.input = None;
            self.output = None;
        }
        if self.child.is_none() {
            let (child, input, output) =
                Self::spawn().map_err(|error| self.startup_error.clone().unwrap_or(error))?;
            self.child = Some(child);
            self.input = Some(input);
            self.output = Some(output);
            self.startup_error = None;
        }
        let expected_id = request.id.clone();
        let input = self
            .input
            .as_mut()
            .ok_or("Python engine input is unavailable")?;
        serde_json::to_writer(&mut *input, &request).map_err(|error| error.to_string())?;
        input
            .write_all(b"\n")
            .and_then(|_| input.flush())
            .map_err(|error| format!("Could not write to Python engine: {error}"))?;
        let mut line = String::new();
        self.output
            .as_mut()
            .ok_or("Python engine output is unavailable")?
            .read_line(&mut line)
            .map_err(|error| format!("Could not read Python engine response: {error}"))?;
        if line.is_empty() {
            return Err("Python engine closed its output unexpectedly".into());
        }
        let response: EngineResponse = serde_json::from_str(&line)
            .map_err(|error| format!("Invalid Python engine response: {error}"))?;
        if response.id != expected_id {
            return Err(format!(
                "Mismatched engine response ID: expected {expected_id}, received {}",
                response.id
            ));
        }
        Ok(response)
    }
}

fn absolute_from_project(project_dir: &Path, path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        project_dir.join(path)
    }
}

fn python_executable(project_dir: &Path) -> std::ffi::OsString {
    if let Some(python) = std::env::var_os("MATHFORGE_PYTHON") {
        let path = PathBuf::from(&python);
        if path.is_relative() && path.components().count() > 1 {
            return project_dir.join(path).into_os_string();
        }
        return python;
    }

    let virtualenv_python = if cfg!(windows) {
        project_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        project_dir.join(".venv").join("bin").join("python")
    };
    if virtualenv_python.is_file() {
        virtualenv_python.into_os_string()
    } else if cfg!(windows) {
        "python".into()
    } else {
        "python3".into()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
