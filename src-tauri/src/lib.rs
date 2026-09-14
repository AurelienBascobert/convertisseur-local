use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Default)]
struct ConversionState {
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectedFile {
    path: String,
    name: String,
    size: u64,
    mime: String,
    category: &'static str,
    targets: Vec<&'static str>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    progress: f32,
    message: String,
}

fn detected_type(path: &Path) -> (String, &'static str) {
    let mime = infer::get_from_path(path)
        .ok()
        .flatten()
        .map(|kind| kind.mime_type().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let category = if mime.starts_with("image/")
        || ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "ico"].contains(&extension.as_str())
    {
        "image"
    } else if mime.starts_with("video/")
        || ["mp4", "mkv", "avi", "mov", "webm", "m4v"].contains(&extension.as_str())
    {
        "video"
    } else if mime.starts_with("audio/")
        || ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"].contains(&extension.as_str())
    {
        "audio"
    } else {
        "unknown"
    };
    (mime, category)
}

fn targets_for(path: &Path, category: &str) -> Vec<&'static str> {
    let source_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let candidates: &[&str] = match category {
        "image" => &["png", "jpg", "webp", "bmp", "tiff", "ico"],
        "video" => &["mp4", "mkv", "webm", "avi", "mov"],
        "audio" => &["mp3", "wav", "flac", "ogg", "aac", "m4a"],
        _ => &[],
    };
    candidates
        .iter()
        .copied()
        .filter(|target| {
            *target != source_extension && !(source_extension == "jpeg" && *target == "jpg")
        })
        .collect()
}

#[tauri::command]
fn inspect_files(paths: Vec<String>) -> Result<Vec<InspectedFile>, String> {
    paths
        .into_iter()
        .map(|raw_path| {
            let path = PathBuf::from(&raw_path);
            let canonical = path
                .canonicalize()
                .map_err(|_| format!("Le fichier « {} » est introuvable.", path.display()))?;
            let metadata = canonical
                .metadata()
                .map_err(|_| format!("Impossible de lire « {} ».", path.display()))?;
            if !metadata.is_file() {
                return Err(format!("« {} » n’est pas un fichier.", path.display()));
            }
            let (mime, category) = detected_type(&canonical);
            Ok(InspectedFile {
                name: canonical
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Fichier")
                    .to_string(),
                path: canonical.to_string_lossy().to_string(),
                size: metadata.len(),
                mime,
                category,
                targets: targets_for(&canonical, category),
            })
        })
        .collect()
}

fn output_path(source: &Path, output_directory: &Path, extension: &str) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Le nom du fichier source n’est pas valide.".to_string())?;
    let mut candidate = output_directory.join(format!("{stem}.{extension}"));
    let mut suffix = 2u32;
    while candidate.exists() {
        candidate = output_directory.join(format!("{stem} ({suffix}).{extension}"));
        suffix += 1;
    }
    Ok(candidate)
}

fn emit_progress(app: &AppHandle, job_id: &str, progress: f32, message: &str) {
    let _ = app.emit(
        "conversion-progress",
        ProgressEvent {
            job_id: job_id.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

async fn convert_image(
    app: AppHandle,
    job_id: String,
    source: PathBuf,
    destination: PathBuf,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    emit_progress(&app, &job_id, 18.0, "Décodage de l’image");
    let destination_for_conversion = destination.clone();
    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let image = image::ImageReader::open(&source)?
            .with_guessed_format()?
            .decode()?;
        image.save(&destination_for_conversion)?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Le traitement de l’image a été interrompu : {error}"))?;
    result.map_err(|error| format!("Impossible de convertir cette image : {error}"))?;
    if cancelled.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(destination);
        return Err("Conversion annulée.".to_string());
    }
    emit_progress(&app, &job_id, 92.0, "Finalisation");
    Ok(())
}

async fn convert_media(
    app: AppHandle,
    job_id: String,
    source: PathBuf,
    destination: PathBuf,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    let arguments = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        source.to_string_lossy().to_string(),
        destination.to_string_lossy().to_string(),
    ];
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("FFmpeg intégré est indisponible : {error}"))?
        .args(arguments);
    let (mut events, mut child) = sidecar
        .spawn()
        .map_err(|error| format!("Impossible de démarrer FFmpeg : {error}"))?;

    let mut progress = 8.0f32;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = std::fs::remove_file(&destination);
            return Err("Conversion annulée.".to_string());
        }
        tokio::select! {
            event = events.recv() => match event {
                Some(CommandEvent::Terminated(payload)) if payload.code == Some(0) => break,
                Some(CommandEvent::Terminated(_)) | None => {
                    let _ = std::fs::remove_file(&destination);
                    return Err("FFmpeg n’a pas pu convertir ce fichier avec le format choisi.".to_string());
                }
                _ => {}
            },
            _ = tokio::time::sleep(Duration::from_millis(180)) => {
                progress = (progress + 1.5).min(90.0);
                emit_progress(&app, &job_id, progress, "Conversion en cours");
            }
        }
    }
    emit_progress(&app, &job_id, 95.0, "Finalisation");
    Ok(())
}

#[tauri::command]
async fn convert_file(
    app: AppHandle,
    state: State<'_, ConversionState>,
    job_id: String,
    source: String,
    target_format: String,
    output_dir: String,
) -> Result<String, String> {
    let source = PathBuf::from(source)
        .canonicalize()
        .map_err(|_| "Le fichier source est introuvable.".to_string())?;
    if !source.is_file() {
        return Err("La source sélectionnée n’est pas un fichier.".to_string());
    }
    let output_dir = PathBuf::from(output_dir)
        .canonicalize()
        .map_err(|_| "Le dossier de destination est introuvable.".to_string())?;
    if !output_dir.is_dir() {
        return Err("La destination sélectionnée n’est pas un dossier.".to_string());
    }

    let (_, category) = detected_type(&source);
    let allowed = targets_for(&source, category);
    let target_format = target_format.to_ascii_lowercase();
    if !allowed.contains(&target_format.as_str()) {
        return Err("Ce format de sortie n’est pas compatible avec le fichier.".to_string());
    }
    let destination = output_path(&source, &output_dir, &target_format)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|_| "Le gestionnaire de conversions est indisponible.".to_string())?
        .insert(job_id.clone(), cancelled.clone());

    emit_progress(&app, &job_id, 5.0, "Préparation");
    let result = if category == "image" {
        convert_image(
            app.clone(),
            job_id.clone(),
            source,
            destination.clone(),
            cancelled,
        )
        .await
    } else {
        convert_media(
            app.clone(),
            job_id.clone(),
            source,
            destination.clone(),
            cancelled,
        )
        .await
    };
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&job_id);
    }
    result?;
    emit_progress(&app, &job_id, 100.0, "Terminé");
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn cancel_conversion(state: State<'_, ConversionState>, job_id: String) -> Result<(), String> {
    let cancellations = state
        .cancellations
        .lock()
        .map_err(|_| "Le gestionnaire de conversions est indisponible.".to_string())?;
    if let Some(flag) = cancellations.get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConversionState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            convert_file,
            cancel_conversion
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Convertisseur Local");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_targets_exclude_source_format() {
        let targets = targets_for(Path::new("photo.png"), "image");
        assert!(!targets.contains(&"png"));
        assert!(targets.contains(&"webp"));
    }

    #[test]
    fn unsupported_files_have_no_targets() {
        assert!(targets_for(Path::new("notes.xyz"), "unknown").is_empty());
    }
}
