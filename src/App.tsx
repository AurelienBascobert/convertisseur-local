import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check, ChevronDown, CircleAlert, Clock3, FileAudio, FileImage, FilePlus2,
  FileVideo, FolderOpen, HardDrive, Image as ImageIcon, LoaderCircle, LockKeyhole,
  Play, ShieldCheck, Sparkles, Trash2, X, Zap,
} from "lucide-react";
import "./App.css";

type FileCategory = "image" | "audio" | "video" | "unknown";
type JobStatus = "ready" | "waiting" | "converting" | "done" | "error" | "cancelled";
type InspectedFile = { path: string; name: string; size: number; mime: string; category: FileCategory; targets: string[] };
type QueueItem = InspectedFile & { id: string; target: string; status: JobStatus; progress: number; error?: string; outputPath?: string };
type ProgressEvent = { jobId: string; progress: number; message: string };

const isTauri = () => "__TAURI_INTERNALS__" in window;
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};
const shortPath = (path: string) => {
  const parts = path.replace(/\//g, "\\").split("\\");
  return parts.length > 2 ? `…\\${parts.slice(-2).join("\\")}` : path;
};
const categoryIcon = (category: FileCategory) => category === "image" ? FileImage : category === "video" ? FileVideo : category === "audio" ? FileAudio : FilePlus2;

function App() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    setNotice("");
    try {
      const inspected = await invoke<InspectedFile[]>("inspect_files", { paths });
      setItems((current) => {
        const known = new Set(current.map((item) => item.path.toLowerCase()));
        const additions = inspected.filter((file) => !known.has(file.path.toLowerCase())).map((file, index) => ({
          ...file, id: `${Date.now()}-${index}-${file.name}`, target: file.targets[0] ?? "", status: "ready" as const, progress: 0,
        }));
        return [...current, ...additions];
      });
    } catch (error) { setNotice(String(error)); }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const progressListener = listen<ProgressEvent>("conversion-progress", ({ payload }) => {
      setItems((current) => current.map((item) => item.id === payload.jobId ? { ...item, progress: payload.progress, status: "converting" } : item));
    });
    const dropListener = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") setIsDragging(true);
      if (event.payload.type === "leave") setIsDragging(false);
      if (event.payload.type === "drop") { setIsDragging(false); void addPaths(event.payload.paths); }
    });
    return () => { void progressListener.then((fn) => fn()); void dropListener.then((fn) => fn()); };
  }, [addPaths]);

  const pickFiles = async () => {
    if (!isTauri()) { setNotice("La sélection de fichiers sera disponible dans l’application de bureau."); return; }
    const selected = await open({ multiple: true, directory: false, title: "Choisir des fichiers à convertir" });
    if (selected) await addPaths(Array.isArray(selected) ? selected : [selected]);
  };
  const pickOutput = async (): Promise<string | null> => {
    if (!isTauri()) { setNotice("Le choix du dossier sera disponible dans l’application de bureau."); return null; }
    const selected = await open({ directory: true, multiple: false, title: "Choisir le dossier de destination" });
    if (typeof selected === "string") { setOutputDir(selected); return selected; }
    return null;
  };

  const readyCount = items.filter((item) => item.target && item.status !== "done").length;
  const completedCount = items.filter((item) => item.status === "done").length;
  const totalSize = useMemo(() => items.reduce((sum, item) => sum + item.size, 0), [items]);

  const convertAll = async () => {
    const destinationDir = outputDir || await pickOutput();
    if (!destinationDir) return;
    setNotice(""); setIsRunning(true);
    const pending = items.filter((item) => item.target && item.status !== "done");
    setItems((current) => current.map((item) => pending.some((job) => job.id === item.id) ? { ...item, status: "waiting" } : item));
    for (const item of pending) {
      try {
        setItems((current) => current.map((job) => job.id === item.id ? { ...job, status: "converting", progress: 4, error: undefined } : job));
        const outputPath = await invoke<string>("convert_file", { jobId: item.id, source: item.path, targetFormat: item.target, outputDir: destinationDir });
        setItems((current) => current.map((job) => job.id === item.id ? { ...job, status: "done", progress: 100, outputPath } : job));
      } catch (error) {
        const message = String(error);
        setItems((current) => current.map((job) => job.id === item.id ? { ...job, status: message.includes("annulée") ? "cancelled" : "error", error: message } : job));
      }
    }
    setIsRunning(false);
  };
  const cancelCurrent = async () => {
    const current = items.find((item) => item.status === "converting");
    if (current && isTauri()) await invoke("cancel_conversion", { jobId: current.id });
  };
  const statusLabel = (item: QueueItem) => item.status === "done" ? "Terminé" : item.status === "converting" ? `${Math.round(item.progress)} %` : item.status === "waiting" ? "En attente" : item.status === "error" ? "Échec" : item.status === "cancelled" ? "Annulé" : item.targets.length ? "Prêt" : "Non pris en charge";

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Sparkles size={20} strokeWidth={2.4} /></span><span>Convertisseur</span><span className="local-pill"><LockKeyhole size={12} /> 100 % local</span></div>
      <span className="desktop-label"><ShieldCheck size={14} /> Application Windows</span>
    </header>
    <main className="workspace">
      <section className="intro">
        <div><p className="eyebrow"><ShieldCheck size={15} /> Vos fichiers ne quittent jamais cet ordinateur</p><h1>Convertissez. Simplement.</h1><p className="subtitle">Images, vidéos et fichiers audio — rapides, privés et sans limite.</p></div>
        <div className="privacy-card"><span className="privacy-icon"><HardDrive size={21} /></span><div><strong>Traitement hors ligne</strong><small>Aucun téléversement, aucune attente</small></div></div>
      </section>
      <section className={`drop-zone ${isDragging ? "dragging" : ""}`} onClick={pickFiles}>
        <div className="drop-visual"><span className="file-card back"><FileVideo size={22} /></span><span className="file-card front"><ImageIcon size={25} /></span><span className="plus-badge">+</span></div>
        <h2>{isDragging ? "Déposez-les ici" : "Glissez vos fichiers ici"}</h2><p>ou cliquez pour les sélectionner</p>
        <button className="secondary-button" type="button"><FilePlus2 size={17} /> Parcourir les fichiers</button><span className="formats">PNG, JPG, WEBP, MP4, WEBM, MP3, WAV, FLAC ET PLUS</span>
      </section>
      {notice && <div className="notice"><CircleAlert size={17} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
      <section className="queue-card">
        <div className="queue-heading"><div><h2>Fichiers à convertir</h2><p>{items.length ? `${items.length} fichier${items.length > 1 ? "s" : ""} · ${formatSize(totalSize)}` : "Votre file d’attente apparaîtra ici"}</p></div>{items.length > 0 && !isRunning && <button className="clear-button" onClick={() => setItems([])}><Trash2 size={15} /> Tout retirer</button>}</div>
        {items.length === 0 ? <div className="empty-state"><Clock3 size={22} /><span>Aucun fichier en attente</span></div> : <div className="file-list">{items.map((item) => {
          const Icon = categoryIcon(item.category);
          return <article className={`file-row status-${item.status}`} key={item.id}>
            <span className={`type-icon ${item.category}`}><Icon size={22} /></span>
            <div className="file-details"><strong title={item.path}>{item.name}</strong><span>{formatSize(item.size)} · {item.mime}</span>{item.status === "converting" && <div className="progress"><span style={{ width: `${item.progress}%` }} /></div>}{item.error && <span className="error-text">{item.error}</span>}</div>
            <div className="target-picker"><span>Convertir en</span><label><select value={item.target} disabled={isRunning || item.targets.length === 0} onChange={(event) => setItems((current) => current.map((job) => job.id === item.id ? { ...job, target: event.target.value } : job))}>{item.targets.length === 0 && <option value="">Indisponible</option>}{item.targets.map((target) => <option key={target} value={target}>{target.toUpperCase()}</option>)}</select><ChevronDown size={15} /></label></div>
            <span className={`status-chip ${item.status}`}>{item.status === "done" && <Check size={14} />}{item.status === "converting" && <LoaderCircle className="spin" size={14} />}{item.status === "error" && <CircleAlert size={14} />}{statusLabel(item)}</span>
            {!isRunning && <button className="remove-button" aria-label={`Retirer ${item.name}`} onClick={() => setItems((current) => current.filter((job) => job.id !== item.id))}><X size={17} /></button>}
          </article>;
        })}</div>}
      </section>
      <section className="action-bar">
        <button className="destination" onClick={pickOutput}><span className="folder-icon"><FolderOpen size={20} /></span><span><small>Dossier de destination</small><strong>{outputDir ? shortPath(outputDir) : "Choisir un dossier"}</strong></span><ChevronDown size={16} /></button>
        <div className="action-summary">{completedCount > 0 && <span><Check size={15} /> {completedCount} terminé{completedCount > 1 ? "s" : ""}</span>}<span>{readyCount} à convertir</span></div>
        {isRunning ? <button className="cancel-button" onClick={cancelCurrent}><X size={17} /> Annuler</button> : <button className="primary-button" disabled={!readyCount} onClick={convertAll}><Play size={17} fill="currentColor" /> Convertir {readyCount ? `(${readyCount})` : ""}</button>}
      </section>
      <footer><span><Zap size={14} /> Propulsé par Rust</span><span className="footer-dot" /><span>Vos fichiers restent privés</span></footer>
    </main>
  </div>;
}

export default App;
