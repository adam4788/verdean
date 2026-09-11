"use client";

import Image from "next/image";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { FindingSourcePreview } from "./components/FindingSourcePreview";
import { ReviewerEmailDialog } from "./components/ReviewerEmailDialog";
import { VerdeanIcon as Icon } from "./components/VerdeanIcon";
import { WorkflowView } from "./components/WorkflowView";
import { analyzeDocuments, classifyDocument, documentFromExtraction, isIgnoredLocalFile, MAX_LOCAL_FILES, readLocalFiles, type AnalysisResult, type DocumentKind, type LocalDocument } from "../lib/verdean/domain";
import { VERDEAN_OUTPUT_DIRECTORY, buildOrganizationPlan, fingerprintFile, organizationFolderForKind, requestReadWritePermission, syncOrganizationPlan, type DirectoryHandleLike, type OrganizationFolder, type PermissionHandleLike } from "../lib/verdean/organization";
import { parseWorkspaceSnapshot, prepareWorkspaceSnapshot, type FindingDisposition, type WorkspaceSourceMode } from "../lib/verdean/workspace";
import { documentIntelligenceIntake, extractRenderedPage, isDocumentIntelligenceFile, releaseRenderedDocument, renderDocument, type RenderedDocumentPage } from "../lib/document-intelligence/client";
import type { DocumentField, DocumentPageExtraction } from "../lib/document-intelligence/provider";

const BRAND = "Verdean";
const stages = ["Cataloging", "Categorizing", "Organizing", "Matching", "Validating"];
const WATCH_INTERVAL_MS = 5_000;

type DocumentStatus = "matched" | "extracted" | "processing" | "failed" | "review" | "queued" | "resolved";
type DocumentItem = { name: string; kind: string; detail: string; status: DocumentStatus };
type QueuedFile = { name: string; reason: string };
type ExtractionSample = { id: string; tab: string; name: string; page: string; image: string; width: number; height: number; fields: DocumentField[]; documentType: string; summary: string; provider: string; model: string; source: "live" };
type IntelligenceJobStatus = "queued" | "rendering" | "processing" | "ready" | "failed";
type IntelligenceJob = { id: string; fileIdentity: string; name: string; status: IntelligenceJobStatus; message: string; completedPages: number; totalPages: number; truncated: boolean; pages: ExtractionSample[]; error?: string };
type ReadableDirectoryHandle = FileSystemDirectoryHandle & { values: () => AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle> };
type DatabaseStatus = "idle" | "loading" | "saving" | "saved" | "restored" | "conflict" | "error";

function kindLabel(kind: DocumentKind) { return kind === "other" ? "Supporting" : `${kind[0].toUpperCase()}${kind.slice(1)}`; }
function extension(name: string) { return name.split(".").pop()?.toUpperCase() ?? "FILE"; }
function liveExtractionSample(jobId: string, documentName: string, totalPages: number, page: RenderedDocumentPage, extraction: DocumentPageExtraction): ExtractionSample {
  return { id: `${jobId}-page-${page.pageNumber}`, tab: `${documentName} · p${page.pageNumber}`, name: documentName, page: `Page ${page.pageNumber} of ${totalPages}`, image: page.previewUrl, width: page.width, height: page.height, fields: extraction.fields, documentType: extraction.documentType, summary: extraction.summary, provider: extraction.provider, model: extraction.model, source: "live" };
}

function findingKey(finding: AnalysisResult["findings"][number]) { return `${finding.contractName}\u0000${finding.evidenceName}\u0000${finding.term}`; }

function documentItems(analysis: AnalysisResult, queued: QueuedFile[], resolvedQueueNames: Set<string>): DocumentItem[] {
  const linked = new Set(analysis.contracts.flatMap((contract) => [contract.name, ...contract.linkedEvidence.map((document) => document.name)]));
  return [
    ...analysis.documents.map((document) => ({ name: document.name, kind: kindLabel(document.kind), detail: `${extension(document.name)} · read locally`, status: linked.has(document.name) ? "matched" : "review" as DocumentStatus })),
    ...queued.map((file) => ({ name: file.name, kind: resolvedQueueNames.has(file.name) ? "Manually reviewed" : "Queued", detail: `${extension(file.name)} · ${file.reason}`, status: resolvedQueueNames.has(file.name) ? "resolved" as const : "queued" as const })),
  ];
}

export default function Home() {
  const uploadRef = useRef<HTMLInputElement>(null);
  const individualUploadRef = useRef<HTMLInputElement>(null);
  const sourceFingerprintsRef = useRef(new Map<string, string>());
  const scanInitializedRef = useRef(false);
  const canWriteRef = useRef(false);
  const intakeGenerationRef = useRef(0);
  const refreshingDirectoryRef = useRef(false);
  const previewUrlsRef = useRef<Map<string, string[]>>(new Map());
  const intelligenceJobsRef = useRef<IntelligenceJob[]>([]);
  const latestReadableDocumentsRef = useRef<LocalDocument[]>([]);
  const extractedDocumentsRef = useRef(new Map<string, LocalDocument>());
  const documentRunRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const persistenceGenerationRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const databaseVersionRef = useRef("");
  const databaseHydratingRef = useRef(false);
  const [analysis, setAnalysis] = useState<AnalysisResult>(analyzeDocuments([]));
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [selectedDirectory, setSelectedDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspace, setWorkspace] = useState("No folder connected");
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [approved, setApproved] = useState(false);
  const [selectedContractName, setSelectedContractName] = useState<string | null>(null);
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [findingDispositions, setFindingDispositions] = useState<Record<string, FindingDisposition>>({});
  const [resolvedQueueNames, setResolvedQueueNames] = useState<Set<string>>(new Set());
  const [organizationErrorCount, setOrganizationErrorCount] = useState(0);
  const [intelligenceJobs, setIntelligenceJobs] = useState<IntelligenceJob[]>([]);
  const [activeSampleId, setActiveSampleId] = useState("");
  const [activeFieldId, setActiveFieldId] = useState("");
  const [activity, setActivity] = useState<string[]>(["Choose a folder or files to begin"]);
  const [organizationStatus, setOrganizationStatus] = useState("Choose a writable folder to organize copies");
  const [hasWriteAccess, setHasWriteAccess] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceSourceMode, setWorkspaceSourceMode] = useState<WorkspaceSourceMode>("files");
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("idle");
  const [activeView, setActiveView] = useState<"review" | "workflow">("review");
  const [previewFinding, setPreviewFinding] = useState<AnalysisResult["findings"][number] | null>(null);
  const [reviewerEmailOpen, setReviewerEmailOpen] = useState(false);

  const analyzeCurrentDocuments = useCallback(() => {
    const next = analyzeDocuments([...latestReadableDocumentsRef.current, ...extractedDocumentsRef.current.values()]);
    setAnalysis(next);
    setApproved(false);
    setFindingDispositions({});
  }, []);

  const beginNewWorkspace = useCallback((sourceMode: WorkspaceSourceMode) => {
    const id = window.crypto.randomUUID();
    persistenceGenerationRef.current += 1;
    databaseVersionRef.current = "";
    databaseHydratingRef.current = false;
    setWorkspaceId(id);
    setWorkspaceSourceMode(sourceMode);
    setDatabaseStatus("idle");
    setActiveView("review");
    setPreviewFinding(null);
    setReviewerEmailOpen(false);
    window.localStorage.setItem("verdean.activeWorkspaceId", id);
  }, []);

  const startOver = useCallback(async () => {
    if (!window.confirm("Return Verdean to its disconnected landing page? This clears the saved review workspace, but leaves your source files and _Verdean copies untouched.")) return;
    const persistedId = workspaceId || window.localStorage.getItem("verdean.activeWorkspaceId");
    persistenceGenerationRef.current += 1;
    window.localStorage.removeItem("verdean.activeWorkspaceId");
    if (persistedId) {
      try {
        await fetch(`/api/workspaces?workspaceId=${encodeURIComponent(persistedId)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch {
        // Local browser state is still cleared so the demo can restart safely.
      }
    }
    window.location.replace("/");
  }, [workspaceId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setStage((current) => current >= stages.length - 1 ? 0 : current + 1), 750);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("reset") === "1") {
      const persistedId = window.localStorage.getItem("verdean.activeWorkspaceId");
      window.localStorage.removeItem("verdean.activeWorkspaceId");
      window.history.replaceState({}, "", window.location.pathname);
      if (persistedId) {
        void fetch(`/api/workspaces?workspaceId=${encodeURIComponent(persistedId)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
          keepalive: true,
        });
      }
      return;
    }
    const persistedId = window.localStorage.getItem("verdean.activeWorkspaceId");
    if (!persistedId) return;
    const generation = ++persistenceGenerationRef.current;
    databaseHydratingRef.current = true;
    queueMicrotask(() => { if (generation === persistenceGenerationRef.current) setDatabaseStatus("loading"); });
    void fetch(`/api/workspaces?workspaceId=${encodeURIComponent(persistedId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) {
          if (generation !== persistenceGenerationRef.current) return;
          window.localStorage.removeItem("verdean.activeWorkspaceId");
          databaseHydratingRef.current = false;
          queueMicrotask(() => setDatabaseStatus("idle"));
          return;
        }
        const body = await response.json() as { workspace?: unknown; version?: string; error?: string };
        if (!response.ok || !body.workspace || !body.version) throw new Error(body.error ?? "Workspace database unavailable.");
        if (generation !== persistenceGenerationRef.current) return;
        const snapshot = parseWorkspaceSnapshot(body.workspace);
        databaseVersionRef.current = body.version;
        setWorkspaceId(snapshot.id);
        setWorkspace(snapshot.name);
        setWorkspaceSourceMode("database");
        setAnalysis(snapshot.analysis);
        setQueuedFiles(snapshot.queuedFiles);
        setResolvedQueueNames(new Set(snapshot.resolvedQueueNames));
        setSelectedContractName(snapshot.selectedContractName);
        setFindingDispositions(snapshot.findingDispositions);
        setApproved(snapshot.approved);
        setActivity(snapshot.activity);
        setOrganizationStatus(snapshot.organizationStatus);
        setHasWorkspace(true);
        setHasWriteAccess(false);
        databaseHydratingRef.current = false;
        setDatabaseStatus("restored");
      })
      .catch(() => { if (generation === persistenceGenerationRef.current) { databaseHydratingRef.current = false; setDatabaseStatus("error"); } });
  }, []);

  useEffect(() => {
    if (!hasWorkspace || !workspaceId || running || databaseHydratingRef.current) return;
    const generation = ++persistenceGenerationRef.current;
    const timer = window.setTimeout(() => {
      let snapshot;
      try {
        snapshot = prepareWorkspaceSnapshot({
          id: workspaceId,
          name: workspace,
          sourceMode: workspaceSourceMode,
          analysis,
          queuedFiles,
          resolvedQueueNames,
          selectedContractName,
          findingDispositions,
          approved,
          activity,
          organizationStatus,
        });
      } catch {
        setDatabaseStatus("error");
        return;
      }
      setDatabaseStatus("saving");
      persistenceQueueRef.current = persistenceQueueRef.current.catch(() => undefined).then(async () => {
        const response = await fetch("/api/workspaces", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-workspace-version": databaseVersionRef.current },
          body: JSON.stringify(snapshot),
        });
        const body = await response.json() as { workspace?: unknown; version?: string; error?: string };
        if (response.status === 409) {
          if (generation === persistenceGenerationRef.current) setDatabaseStatus("conflict");
          return;
        }
        if (!response.ok || !body.workspace || !body.version) throw new Error(body.error ?? "Workspace database unavailable.");
        const verified = parseWorkspaceSnapshot(body.workspace);
        if (verified.id !== workspaceId) throw new Error("Workspace verification failed.");
        databaseVersionRef.current = body.version;
        if (generation === persistenceGenerationRef.current) {
          window.localStorage.setItem("verdean.activeWorkspaceId", verified.id);
          setDatabaseStatus("saved");
        }
      }).catch(() => { if (generation === persistenceGenerationRef.current) setDatabaseStatus("error"); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activity, analysis, approved, findingDispositions, hasWorkspace, organizationStatus, queuedFiles, resolvedQueueNames, running, selectedContractName, workspace, workspaceId, workspaceSourceMode]);

  const updateIntelligenceJobs = useCallback((change: (items: IntelligenceJob[]) => IntelligenceJob[]) => {
    const next = change(intelligenceJobsRef.current);
    intelligenceJobsRef.current = next;
    setIntelligenceJobs(next);
  }, []);
  const releaseJobPreviews = useCallback((jobId: string) => {
    for (const url of previewUrlsRef.current.get(jobId) ?? []) URL.revokeObjectURL(url);
    previewUrlsRef.current.delete(jobId);
  }, []);
  const clearLivePreviews = useCallback(() => {
    for (const jobId of previewUrlsRef.current.keys()) releaseJobPreviews(jobId);
  }, [releaseJobPreviews]);
  const cancelDocumentIntelligence = useCallback(() => { documentRunRef.current.controller?.abort(); documentRunRef.current = { generation: documentRunRef.current.generation + 1, controller: null }; }, []);
  useEffect(() => () => { intakeGenerationRef.current += 1; cancelDocumentIntelligence(); clearLivePreviews(); }, [cancelDocumentIntelligence, clearLivePreviews]);

  const runDocumentIntelligence = useCallback(async (inputs: { file: File; identity: string }[], generation: number, organization?: { directory: ReadableDirectoryHandle; canWrite: boolean }) => {
    const controller = new AbortController();
    documentRunRef.current.controller?.abort();
    documentRunRef.current = { generation, controller };
    const current = () => intakeGenerationRef.current === generation && documentRunRef.current.generation === generation && !controller.signal.aborted;
    const jobs = inputs.map(({ file, identity: fileIdentity }): IntelligenceJob => {
      return { id: `${generation}-${fileIdentity}`, fileIdentity, name: file.webkitRelativePath || file.name, status: "queued", message: "Queued for optional document intelligence", completedPages: 0, totalPages: 0, truncated: false, pages: [] };
    });
    if (!current()) return;
    const superseded = intelligenceJobsRef.current.filter((job) => jobs.some((next) => next.fileIdentity === job.fileIdentity));
    for (const job of superseded) releaseJobPreviews(job.id);
    updateIntelligenceJobs((existing) => [...existing.filter((job) => !jobs.some((next) => next.fileIdentity === job.fileIdentity)), ...jobs]);
    for (const job of jobs) {
      const file = inputs[jobs.indexOf(job)]!.file;
      const update = (change: (item: IntelligenceJob) => IntelligenceJob) => { if (current()) updateIntelligenceJobs((items) => items.map((item) => item.id === job.id ? change(item) : item)); };
      let rendered: Awaited<ReturnType<typeof renderDocument>> | undefined;
      let keepPreviews = false;
      let discardJob = false;
      const completedPages: ExtractionSample[] = [];
      const organizeVisualFile = async (folder: OrganizationFolder) => {
        if (!organization?.canWrite) return;
        const sync = await syncOrganizationPlan(organization.directory as unknown as DirectoryHandleLike, [{
          file,
          folder,
          fingerprint: fingerprintFile(file),
        }]);
        if (!current()) return;
        setOrganizationErrorCount((count) => count + sync.errors.length);
        setOrganizationStatus(`Visual documents: organized ${sync.copied}, skipped ${sync.skipped}; ${sync.errors.length} needs attention`);
        setActivity((items) => [
          `${file.name} categorized into ${VERDEAN_OUTPUT_DIRECTORY}/${folder}`,
          ...sync.errors.map((error) => `Could not organize ${error.name}: ${error.message}`),
          ...items,
        ]);
      };
      try {
        update((item) => ({ ...item, status: "rendering", message: "Rendering pages locally" }));
        const document = await renderDocument(file, controller.signal);
        rendered = document;
        if (!current()) { discardJob = true; releaseRenderedDocument(document); return; }
        previewUrlsRef.current.set(job.id, document.pages.map((page) => page.previewUrl));
        update((item) => ({ ...item, status: "processing", message: `Extracting page 1 of ${document.pages.length}`, totalPages: document.totalPages, truncated: document.truncated }));
        for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex += 1) {
          const page = document.pages[pageIndex]!;
          update((item) => ({ ...item, message: `Extracting page ${pageIndex + 1} of ${document.pages.length}` }));
          const extraction = await extractRenderedPage(page, { signal: controller.signal });
          if (!current()) { discardJob = true; return; }
          const sample = liveExtractionSample(job.id, job.name, document.totalPages, page, extraction);
          completedPages.push(sample);
          update((item) => ({ ...item, pages: [...completedPages], completedPages: pageIndex + 1 }));
          if (pageIndex === 0) { setActiveSampleId(sample.id); setActiveFieldId(sample.fields[0]?.id ?? ""); }
        }
        const extractedDocument = documentFromExtraction(job.name, completedPages);
        extractedDocumentsRef.current.set(job.fileIdentity, extractedDocument);
        analyzeCurrentDocuments();
        await organizeVisualFile(organizationFolderForKind(classifyDocument(extractedDocument)));
        update((item) => ({ ...item, status: "ready", message: `${document.pages.length} page${document.pages.length === 1 ? "" : "s"} extracted and included in comparison` }));
        keepPreviews = true;
      } catch (error) {
        if (rendered && !previewUrlsRef.current.has(job.id)) releaseRenderedDocument(rendered);
        if (!current() || (error instanceof DOMException && error.name === "AbortError")) { discardJob = true; return; }
        const message = error instanceof Error ? error.message : "Document intelligence failed.";
        extractedDocumentsRef.current.delete(job.fileIdentity);
        analyzeCurrentDocuments();
        await organizeVisualFile("Needs Review");
        update((item) => ({ ...item, status: "failed", message: "Needs attention", error: message, pages: [] }));
      } finally {
        if (!keepPreviews) releaseJobPreviews(job.id);
        if (discardJob) updateIntelligenceJobs((items) => items.filter((item) => item.id !== job.id));
      }
    }
  }, [analyzeCurrentDocuments, releaseJobPreviews, updateIntelligenceJobs]);

  const ingest = useCallback(async (files: File[], options?: { directory?: ReadableDirectoryHandle; canWrite?: boolean; snapshot?: boolean; filesToOrganize?: File[]; intakeFailures?: QueuedFile[]; generation?: number }) => {
    const generation = options?.generation ?? intakeGenerationRef.current;
    if (generation !== intakeGenerationRef.current) return;
    const sourceFiles = files.filter((file) => !isIgnoredLocalFile(file.webkitRelativePath || file.name));
    const filesToOrganize = (options?.filesToOrganize ?? sourceFiles).filter((file) => !isIgnoredLocalFile(file.webkitRelativePath || file.name));
    setWorkspace(options?.snapshot ? `Selected files / ${sourceFiles.length} documents` : `Local folder / ${sourceFiles.length} documents`);
    setWorkspaceSourceMode(options?.snapshot ? "files" : "folder");
    setHasWorkspace(true);
    setApproved(false);
    setSelectedContractName(null);
    setShowAllFindings(false);
    setFindingDispositions({});
    setStage(0);
    setRunning(true);
    setActivity([`Added ${sourceFiles.length} local documents`, "Reading supported text, CSV, and JSON files locally"]);

    const readableInputs = sourceFiles.map((file) => ({ name: file.webkitRelativePath || file.name, size: file.size, text: () => file.text() }));
    const readResult = await readLocalFiles(readableInputs);
    if (generation !== intakeGenerationRef.current) return;
    latestReadableDocumentsRef.current = readResult.documents;
    const { visualEntries, selectedVisualEntries: intelligenceInputs } = documentIntelligenceIntake(sourceFiles, filesToOrganize);
    const sourceIdentities = new Set(visualEntries.map(({ identity }) => identity));
    for (const job of intelligenceJobsRef.current) if (!sourceIdentities.has(job.fileIdentity)) releaseJobPreviews(job.id);
    updateIntelligenceJobs((items) => items.filter((job) => sourceIdentities.has(job.fileIdentity)));
    for (const identity of extractedDocumentsRef.current.keys()) if (!sourceIdentities.has(identity)) extractedDocumentsRef.current.delete(identity);
    for (const { identity } of intelligenceInputs) extractedDocumentsRef.current.delete(identity);
    const analysis = analyzeDocuments([...latestReadableDocumentsRef.current, ...extractedDocumentsRef.current.values()]);
    const unresolvedFiles = [...readResult.queued, ...readResult.errors.map((file) => ({ name: file.name, reason: file.message })), ...(options?.intakeFailures ?? [])];
    const organizationActivity: string[] = [];
    let nextOrganizationErrorCount = 0;
    let nextOrganizationStatus = "No organization changes were needed";

    if (options?.directory && options.canWrite) {
      const filesReadyForOrganization = filesToOrganize.filter((file) => !isDocumentIntelligenceFile(file));
      const plan = await buildOrganizationPlan(filesReadyForOrganization);
      if (generation !== intakeGenerationRef.current) return;
      const sync = await syncOrganizationPlan(options.directory as unknown as DirectoryHandleLike, plan);
      if (generation !== intakeGenerationRef.current) return;
      nextOrganizationErrorCount = sync.errors.length;
      nextOrganizationStatus = `Organized ${sync.copied} new, skipped ${sync.skipped} remembered; ${sync.errors.length} needs attention`;
      organizationActivity.push(`Organized ${sync.copied} new files and skipped ${sync.skipped} remembered copies under ${VERDEAN_OUTPUT_DIRECTORY}`, ...sync.errors.map((error) => `Could not organize ${error.name}: ${error.message}`));
    } else if (options?.snapshot) {
      nextOrganizationStatus = `Snapshot categorized ${sourceFiles.length} files — read-only; originals are preserved and no physical copies were written`;
      organizationActivity.push("Snapshot/read-only import: categorized in-app only. Physical copies require writable folder access.");
    } else if (options?.directory) {
      nextOrganizationStatus = `Categorized ${sourceFiles.length} files; originals are preserved and write permission was not granted, so no physical copies were written`;
      organizationActivity.push("Folder permission was not granted: categorized in-app only; no physical copies written.");
    }

    if (generation !== intakeGenerationRef.current) return;
    setOrganizationErrorCount(nextOrganizationErrorCount);
    setOrganizationStatus(nextOrganizationStatus);
    setAnalysis(analysis);
    setQueuedFiles(unresolvedFiles);
    setResolvedQueueNames((current) => new Set([...current].filter((name) => unresolvedFiles.some((file) => file.name === name))));
    setActivity([
      ...organizationActivity,
      ...analysis.activity,
      ...readResult.queued.map((file) => `Queued ${file.name} for manual review`),
      ...readResult.errors.map((file) => `Could not read ${file.name}: ${file.message}`),
      ...(options?.intakeFailures ?? []).map((file) => `Folder scan failed for ${file.name}: ${file.reason}`),
    ]);
    if (intelligenceInputs.length) void runDocumentIntelligence(intelligenceInputs, generation, options?.directory ? { directory: options.directory, canWrite: options.canWrite ?? false } : undefined);
    setStage(stages.length - 1);
    setRunning(false);
  }, [releaseJobPreviews, runDocumentIntelligence, updateIntelligenceJobs]);


  const refreshDirectory = useCallback(async (directory: FileSystemDirectoryHandle, force = false, forceOrganization = false, generation = intakeGenerationRef.current) => {
    if (refreshingDirectoryRef.current) return;
    refreshingDirectoryRef.current = true;
    try {
    const files: File[] = [];
    const intakeFailures: QueuedFile[] = [];
    const readableDirectory = directory as ReadableDirectoryHandle;
    let fileCount = 0;
    for await (const entry of readableDirectory.values()) {
      if (generation !== intakeGenerationRef.current) return;
      if (entry.kind !== "file" || entry.name === VERDEAN_OUTPUT_DIRECTORY || isIgnoredLocalFile(entry.name)) continue;
      if (fileCount >= MAX_LOCAL_FILES) {
        intakeFailures.push({ name: "Additional folder files", reason: `Folder scan stopped at the ${MAX_LOCAL_FILES}-file direct-file limit.` });
        break;
      }
      fileCount += 1;
      try { files.push(await entry.getFile()); } catch (cause) { intakeFailures.push({ name: entry.name, reason: `Folder scan failed: ${cause instanceof Error ? cause.message : "Unavailable from selected folder."}` }); }
    }
    if (generation !== intakeGenerationRef.current) return;
    const current = new Map(files.map((file) => [file.name, fingerprintFile(file)]));
    const previous = sourceFingerprintsRef.current;
    const firstScan = !scanInitializedRef.current;
    const changed = firstScan ? files : files.filter((file) => previous.get(file.name) !== current.get(file.name));
    const removed = !firstScan && [...previous.keys()].some((name) => !current.has(name));
    sourceFingerprintsRef.current = current;
    scanInitializedRef.current = true;
    if (!firstScan && changed.length === 0 && !removed && !force && intakeFailures.length === 0) return;
    await ingest(files, { directory: readableDirectory, canWrite: canWriteRef.current, filesToOrganize: forceOrganization ? files : changed, intakeFailures, generation });
    if (generation !== intakeGenerationRef.current) return;
    setWorkspace(`${directory.name} / ${files.length} documents`);
    } finally {
      refreshingDirectoryRef.current = false;
    }
  }, [ingest]);

  useEffect(() => {
    if (!selectedDirectory) return;
    let timer: number | undefined;
    let refreshing = false;

    const refreshWhenActive = () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      void refreshDirectory(selectedDirectory)
        .catch(() => setActivity((items) => ["Could not refresh the selected local folder", ...items]))
        .finally(() => { refreshing = false; });
    };
    const startWatching = () => {
      if (document.visibilityState !== "visible" || timer !== undefined) return;
      refreshWhenActive();
      timer = window.setInterval(refreshWhenActive, WATCH_INTERVAL_MS);
    };
    const stopWatching = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const updateWatching = () => {
      if (document.visibilityState === "visible") startWatching();
      else stopWatching();
    };

    document.addEventListener("visibilitychange", updateWatching);
    startWatching();
    return () => {
      document.removeEventListener("visibilitychange", updateWatching);
      stopWatching();
    };
  }, [refreshDirectory, selectedDirectory]);

  const chooseFolder = async () => {
    const picker = (window as Window & { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) { uploadRef.current?.click(); return; }
    try {
      const handle = await picker({ mode: "readwrite" });
      const generation = ++intakeGenerationRef.current;
      beginNewWorkspace("folder");
      cancelDocumentIntelligence();
      clearLivePreviews();
      updateIntelligenceJobs(() => []);
      latestReadableDocumentsRef.current = [];
      extractedDocumentsRef.current.clear();
      // This is deliberately still in the click gesture so browsers may show a write grant prompt.
      try {
        canWriteRef.current = await requestReadWritePermission(handle as FileSystemDirectoryHandle & PermissionHandleLike);
      } catch {
        canWriteRef.current = false;
      }
      setHasWriteAccess(canWriteRef.current);
      setSelectedDirectory(handle);
      sourceFingerprintsRef.current = new Map();
      scanInitializedRef.current = false;
      setResolvedQueueNames(new Set());
      setOrganizationErrorCount(0);
      await refreshDirectory(handle, false, false, generation);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") uploadRef.current?.click();
    }
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const generation = ++intakeGenerationRef.current;
    cancelDocumentIntelligence();
    clearLivePreviews();
    updateIntelligenceJobs(() => []);
    latestReadableDocumentsRef.current = [];
    extractedDocumentsRef.current.clear();
    setSelectedDirectory(null);
    sourceFingerprintsRef.current = new Map();
    scanInitializedRef.current = false;
    canWriteRef.current = false;
    setHasWriteAccess(false);
    setResolvedQueueNames(new Set());
    setOrganizationErrorCount(0);
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    beginNewWorkspace("files");
    void ingest(files, { snapshot: true, generation });
  };
  const retryScan = () => {
    if (!selectedDirectory) return;
    void refreshDirectory(selectedDirectory, true, false, intakeGenerationRef.current).catch((cause) => setActivity((items) => [`Retry scan failed: ${cause instanceof Error ? cause.message : "Unavailable"}`, ...items]));
  };

  const retryOrganization = async () => {
    if (!selectedDirectory) return;
    let granted = false;
    try { granted = await requestReadWritePermission(selectedDirectory as FileSystemDirectoryHandle & PermissionHandleLike); } catch { granted = false; }
    canWriteRef.current = granted;
    setHasWriteAccess(granted);
    if (!granted) {
      setOrganizationErrorCount(1);
      setOrganizationStatus("Write access is required to retry organization");
      return;
    }
    await refreshDirectory(selectedDirectory, true, true, intakeGenerationRef.current);
  };

  const resolveQueuedFile = (name: string) => {
    setResolvedQueueNames((current) => new Set([...current, name]));
    setApproved(false);
    setActivity((items) => [`Manually reviewed ${name}`, ...items]);
  };

  const readyIntelligenceNames = new Set(intelligenceJobs.filter((job) => job.status === "ready").map((job) => job.name));
  const blockingQueuedFiles = queuedFiles.filter((file) => !resolvedQueueNames.has(file.name) && !readyIntelligenceNames.has(file.name));
  const blockingIntelligenceJobs = intelligenceJobs.filter((job) => job.status !== "ready" && !(job.status === "failed" && resolvedQueueNames.has(job.id)));
  const scanFailureCount = blockingQueuedFiles.filter((file) => file.reason.startsWith("Folder scan failed:")).length;
  const liveExtractionPages = intelligenceJobs.flatMap((job) => job.pages);
  const availableSamples = liveExtractionPages;
  const extractionFieldCount = availableSamples.reduce((total, sample) => total + sample.fields.length, 0);
  const intelligenceDocuments: DocumentItem[] = intelligenceJobs.map((job) => ({ name: job.name, kind: job.status === "failed" && resolvedQueueNames.has(job.id) ? "Manually reviewed" : "Optional document intelligence", detail: job.error ?? job.message, status: job.status === "ready" ? "extracted" : job.status === "failed" ? (resolvedQueueNames.has(job.id) ? "resolved" : "failed") : "processing" }));
  const documents = [...documentItems(analysis, queuedFiles.filter((file) => !readyIntelligenceNames.has(file.name)), resolvedQueueNames), ...intelligenceDocuments];
  const needsContractChoice = analysis.contracts.length > 1 && !selectedContractName;
  const contract = analysis.contracts.length === 1
    ? analysis.contracts[0]
    : analysis.contracts.find((item) => item.name === selectedContractName);
  const findings = contract
    ? analysis.findings.filter((finding) => finding.contractName === contract.name)
    : analysis.contracts.length > 1 ? [] : analysis.findings;
  const quoteCount = analysis.documents.filter((document) => document.kind === "quote").length;
  const invoiceCount = analysis.documents.filter((document) => document.kind === "invoice").length;
  const contractCount = analysis.documents.filter((document) => document.kind === "contract").length;
  const relationshipCount = analysis.contracts.reduce((total, item) => total + item.linkedEvidence.length, 0);
  const visibleFindings = showAllFindings ? findings : findings.slice(0, 3);
  const allFindingsDispositioned = findings.every((finding) => Boolean(findingDispositions[findingKey(finding)]));
  const reviewReady = Boolean(contract) && blockingQueuedFiles.length === 0 && blockingIntelligenceJobs.length === 0 && (analysis.pipeline.status === "review-ready" || analysis.contracts.length > 1);
  const canApprove = reviewReady && allFindingsDispositioned;
  const requestFixesForAll = () => {
    setFindingDispositions(Object.fromEntries(findings.map((finding) => [findingKey(finding), "fix-contract" as FindingDisposition])));
    setApproved(false);
    setShowAllFindings(true);
    setActivity((items) => [`Contract fixes requested for ${findings.length} differences`, ...items]);
  };
  const reviewTitle = needsContractChoice
    ? "Choose the governing contract"
    : !reviewReady ? "Review blocked"
      : findings.length ? `${findings.length} difference${findings.length === 1 ? "" : "s"} need review`
        : "No differences found";
  const reviewMessage = needsContractChoice
    ? `${analysis.contracts.length} contracts found. Choose the one that governs this review.`
    : blockingQueuedFiles.length ? `${blockingQueuedFiles.length} unresolved file${blockingQueuedFiles.length === 1 ? "" : "s"} must be reviewed first.`
      : blockingIntelligenceJobs.length ? `${blockingIntelligenceJobs.length} PDF or scan ${blockingIntelligenceJobs.length === 1 ? "is" : "are"} still processing or needs manual review.`
      : contract && findings.length ? "Compare the highlighted terms below."
        : contract ? "No commercial differences were found."
          : analysis.pipeline.message;
  const primaryActionLabel = needsContractChoice ? "Choose contract" : !reviewReady ? "Resolve input" : findings.length && !allFindingsDispositioned ? "Review differences" : "Review result";
  const primaryActionTarget = needsContractChoice ? "#governing-contract" : !reviewReady ? "#documents" : "#findings";
  const activeSample = availableSamples.find((sample) => sample.id === activeSampleId) ?? liveExtractionPages[0];
  const activeField = activeSample?.fields.find((field) => field.id === activeFieldId) ?? activeSample?.fields[0];
  const selectSample = (sample: ExtractionSample) => { setActiveSampleId(sample.id); setActiveFieldId(sample.fields[0]?.id ?? ""); };
  const previewEvidence = previewFinding ? analysis.documents.find((document) => document.name === previewFinding.evidenceName) : undefined;
  const previewContract = previewFinding ? analysis.documents.find((document) => document.name === previewFinding.contractName) : undefined;

  const pipelinePanel = (
    <section className="pipeline" aria-label="Agent validation pipeline"><div className="pipeline-head"><div><p className="section-kicker">Agent pipeline</p><h3>{running ? `${stages[stage]} your workspace` : reviewReady ? "Validation complete" : "Input required"}</h3></div><span className="live-label"><i /> {running ? "Live" : reviewReady ? "Complete" : "Blocked"}</span></div><div className="stage-list">{stages.map((item, index) => <div className={`stage ${index < stage || (!running && index <= stage) ? "done" : ""} ${index === stage && running ? "current" : ""}`} key={item}><span>{index < stage || (!running && index <= stage) ? <Icon name="check" /> : index + 1}</span><strong>{item}</strong><small>{index === 0 ? `${documents.length} documents` : index === 1 ? "Document types" : index === 2 ? "_Verdean copies" : index === 3 ? "Terms & dates" : "Exceptions"}</small></div>)}</div></section>
  );

  return (
    <main className="app-shell">
      <input ref={uploadRef} className="sr-only" type="file" multiple onChange={onUpload} aria-label="Upload a folder of documents" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
      <input ref={individualUploadRef} className="sr-only" type="file" multiple accept=".txt,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" onChange={onUpload} aria-label="Choose documents for analysis" />
      <header className="topbar"><a className="brand" href="#workspace" aria-label={`${BRAND} home`}><Image className="brand-logo" src="/verdean-horizontal.svg" alt="Verdean" width={283} height={72} priority /></a><div className="topbar-actions"><span className="privacy-note"><span className="privacy-dot" /> Live contract workspace</span>{hasWorkspace && <><button className="quiet-button" onClick={chooseFolder}>Change folder</button><button className="quiet-button start-over-button" onClick={() => void startOver()}>Start over</button></>}</div></header>
      {!hasWorkspace && <><section className="hero onboarding-hero" id="workspace"><div><p className="eyebrow"><Icon name="link" /> Human-controlled contract validation</p><h1>Find what changed before you sign.</h1><p className="hero-copy">Connect the folder where commercial evidence and contracts arrive. {BRAND} reads the actual files, organizes safe copies, matches related records, and surfaces every difference for review.</p></div><div className="hero-actions connection-card"><span className="connection-status"><i /> No folder connected</span><p className="action-kicker">Connect your documents</p><button className="primary-button" onClick={chooseFolder}><Icon name="folder" /> Connect a folder <Icon name="arrow" /></button><button className="secondary-button" onClick={() => individualUploadRef.current?.click()}>Choose individual files</button><p>Text, CSV, and JSON are processed in this browser. For PDFs and scans, only rendered page images are sent to the configured document-intelligence provider.</p></div></section><section className="product-flow" aria-label="How Verdean works"><div><span>01</span><strong>Connect</strong><p>Select a folder or files you already use.</p></div><div><span>02</span><strong>Reconcile</strong><p>The agent categorizes, links, and validates every promise.</p></div><div><span>03</span><strong>Resolve</strong><p>Review source-backed differences and record a disposition.</p></div></section></>}
      {hasWorkspace && <section className="dashboard" aria-label={`${BRAND} workspace dashboard`}><aside className="sidebar"><div className="workspace-label">Workspace</div><h2>{workspace}</h2><div className="status-pill" role="status" aria-live="polite" aria-atomic="true"><span className="pulse" /> {running ? "Agent working" : approved ? "Reviewed" : reviewReady ? "Ready for review" : "Needs input"}</div><nav aria-label="Workspace views"><button className={activeView === "review" ? "active" : ""} aria-pressed={activeView === "review"} aria-controls="workspace-view" onClick={() => setActiveView("review")}>Review</button><button className={activeView === "workflow" ? "active" : ""} aria-pressed={activeView === "workflow"} aria-controls="workspace-view" onClick={() => { setActiveView("workflow"); window.setTimeout(() => document.getElementById("workflow-title")?.focus(), 0); }}>Workflow</button>{activeView === "review" && <><a href="#documents">Files <b>{documents.length}</b></a><a href="#findings">Differences <b>{findings.length}</b></a></>}</nav><div className="sidebar-foot"><p>Workspace source</p><small>{selectedDirectory ? `Watching ${selectedDirectory.name} while this tab is open` : workspaceSourceMode === "database" ? "Dashboard restored from D1. Reconnect the folder to resume local watching." : "Selected files loaded; physical copies require writable folder access."}</small></div><div className="sidebar-foot"><p>Database</p><small className={`database-state ${databaseStatus}`} role="status" aria-live="polite">{databaseStatus === "saved" ? "Saved and verified in D1" : databaseStatus === "restored" ? "Loaded from D1" : databaseStatus === "saving" ? "Saving to D1…" : databaseStatus === "loading" ? "Loading from D1…" : databaseStatus === "conflict" ? "Changed in another tab — reload required" : databaseStatus === "error" ? "Database needs attention" : "Waiting for intake"}</small></div><div className="sidebar-foot"><p>Organization</p><small aria-live="polite">{organizationStatus}{selectedDirectory && hasWriteAccess ? ` · ${VERDEAN_OUTPUT_DIRECTORY}` : ""}</small><small>Originals are preserved.</small></div></aside>
        <div className="content" id="workspace-view">
          {activeView === "workflow" ? <WorkflowView running={running} documentCount={analysis.documents.length} quoteCount={quoteCount} invoiceCount={invoiceCount} contractCount={contractCount} relationshipCount={relationshipCount} findingCount={analysis.findings.length} organizationStatus={organizationStatus} databaseStatus={databaseStatus} sourceStatus={selectedDirectory ? `Watching ${selectedDirectory.name}` : workspaceSourceMode === "database" ? "Restored from the durable workspace database" : "Selected files are loaded in this browser"} /> : <>
          <section className="overview-panel" id="overview"><div><p className="section-kicker">Review summary</p><h2>{approved ? "Review complete" : reviewTitle}</h2><p>{approved ? "Human review recorded. All differences remain visible below." : reviewMessage}</p></div><a className="review-button" href={primaryActionTarget}>{primaryActionLabel}</a></section>
          {(scanFailureCount > 0 || organizationErrorCount > 0) && <div className="recovery-banner" role="alert"><div><strong>Some files need attention</strong><p>{scanFailureCount > 0 ? `${scanFailureCount} folder item${scanFailureCount === 1 ? "" : "s"} could not be read.` : `${organizationErrorCount} organized cop${organizationErrorCount === 1 ? "y" : "ies"} failed.`}</p></div><div>{scanFailureCount > 0 && <button onClick={retryScan}>Retry scan</button>}{organizationErrorCount > 0 && <button onClick={() => void retryOrganization()}>Retry organization</button>}</div></div>}
          {running ? pipelinePanel : <details className="advanced-panel"><summary><span>Run details</span><small>5 steps · {reviewReady ? "Complete" : "Needs input"}</small></summary>{pipelinePanel}</details>}
          <div className="grid-two"><section className="card" id="documents"><div className="card-head"><div><p className="section-kicker">Document set</p><h3>What the agent found</h3></div><button className="link-button" onClick={chooseFolder}>Choose another folder</button></div><div className="document-list">{documents.map((doc) => <div className="document-row" key={`${doc.name}-${doc.kind}`}><span className="file-icon"><Icon name="file" /></span><div><strong>{doc.name}</strong><small>{doc.kind} · {doc.detail}</small></div><div className="document-actions"><span className={`tag ${doc.status}`}>{doc.status === "matched" ? "Matched" : doc.status === "extracted" ? "Included" : doc.status === "resolved" ? "Ready" : doc.status === "processing" ? "Processing" : doc.status === "failed" ? "Failed" : doc.status === "queued" ? "Queued" : "Review"}</span>{doc.status === "queued" && <button className="queue-action" onClick={() => resolveQueuedFile(doc.name)}>Mark manually reviewed</button>}</div></div>)}</div>{documents.length === 0 && <div className="empty-state"><strong>No files to review yet</strong><p>Choose another folder with quote, invoice, email, transcript, or contract files.</p></div>}<p className="footnote">{blockingQueuedFiles.length ? `${blockingQueuedFiles.length} file${blockingQueuedFiles.length > 1 ? "s are" : " is"} waiting for manual review. ` : resolvedQueueNames.size ? `${resolvedQueueNames.size} queued file${resolvedQueueNames.size > 1 ? "s were" : " was"} manually reviewed. ` : ""}Text, CSV, and JSON are compared locally. Successful PDF/scan extractions are included in the comparison; pending or failed files block review until resolved.</p></section>
            <section className="card evidence-card" id="governing-contract">
              <div className="card-head"><div><p className="section-kicker">Evidence match</p><h3>{needsContractChoice ? "Choose the governing contract" : "Connected evidence"}</h3></div><span className="confidence">{contract ? `${contract.confidence}% confidence` : `${analysis.contracts.length} contract${analysis.contracts.length === 1 ? "" : "s"}`}</span></div>
              {analysis.contracts.length > 1 && <label className="contract-picker"><span>Governing contract</span><select value={selectedContractName ?? ""} onChange={(event) => { const name = event.target.value || null; setSelectedContractName(name); setApproved(false); setShowAllFindings(false); setFindingDispositions({}); if (name) setActivity((items) => [`Selected ${name} as governing contract`, ...items]); }}><option value="">Choose a contract…</option>{analysis.contracts.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>}
              {contract ? <><div className="score"><span>{contract.confidence}</span><div><strong>{contract.confidence >= 80 ? "High-confidence match" : "Evidence match"}</strong><p>{contract.referenceId ?? contract.name} ↔ {contract.linkedEvidence.length} evidence file{contract.linkedEvidence.length === 1 ? "" : "s"}</p></div></div>{contract.confidenceReason.map((reason) => <div className="evidence-line" key={reason}><span>{reason.replace(/ \(\+\d+\)/, "")}</span><em>Linked</em></div>)}</> : <div className="empty-state"><strong>{needsContractChoice ? "Choose one contract to continue" : "No supported contract found"}</strong><p>{needsContractChoice ? "Verdean will recalculate differences for the contract you select." : "Choose another folder containing a TXT, CSV, or JSON contract."}</p></div>}
            </section></div>
          {intelligenceJobs.length > 0 && <details className="advanced-panel extraction-panel" id="extraction"><summary><span>Document intelligence</span><small>{extractionFieldCount} extracted field{extractionFieldCount === 1 ? "" : "s"}</small></summary>
          <section className="card extraction-card"><div className="card-head extraction-head"><div><p className="section-kicker">Document intelligence</p><h3>See every value in context</h3><p>Bounding boxes connect extracted fields directly to their source regions.</p></div><span className="intelligence-badge"><Icon name="link" /> Live extraction</span></div>
          {intelligenceJobs.length > 0 && <div className="intelligence-queue" aria-live="polite">{intelligenceJobs.map((job) => { const progress = job.totalPages ? Math.round(job.completedPages / Math.min(job.totalPages, 6) * 100) : job.status === "rendering" ? 12 : 4; return <div className={`intelligence-job ${job.status}`} key={job.id}><div><span className="job-state">{job.status === "ready" ? <Icon name="check" /> : job.status === "failed" ? "!" : <i />}</span><span><strong>{job.name}</strong><small>{job.error ?? job.message}{job.truncated ? " · first 6 pages" : ""}</small></span><em>{job.status === "ready" ? "Included" : job.status === "failed" ? "Failed" : `${progress}%`}</em>{job.status === "failed" && !resolvedQueueNames.has(job.id) && <button className="queue-action" onClick={() => resolveQueuedFile(job.id)}>Mark manually reviewed</button>}</div><span className="job-progress"><i style={{ width: `${job.status === "ready" ? 100 : progress}%` }} /></span></div>; })}</div>}
          {availableSamples.length > 0 && <div className="sample-tabs">{availableSamples.map((sample) => <button className={sample.id === activeSample.id ? "active" : ""} key={sample.id} aria-pressed={sample.id === activeSample.id} onClick={() => selectSample(sample)}>{sample.tab}</button>)}</div>}
          {availableSamples.length > 0 && activeSample && activeField ? <div className="extraction-workspace"><div className="document-viewport"><div className="document-toolbar"><span><i className="vision-dot" /> Live document intelligence</span><span>{activeSample.page} · {activeSample.width} × {activeSample.height}</span></div><div className="document-canvas"><Image unoptimized src={activeSample.image} width={activeSample.width} height={activeSample.height} sizes="(max-width: 620px) calc(100vw - 96px), 490px" alt={`${activeSample.name}, ${activeSample.page}`} />{activeSample.fields.map((field, index) => <button className={`annotation-box ${field.id === activeField.id ? "active" : ""}`} style={{ left: `${field.box.left}%`, top: `${field.box.top}%`, width: `${field.box.width}%`, height: `${field.box.height}%` }} key={field.id} onClick={() => setActiveFieldId(field.id)} aria-label={`Highlight ${field.label}: ${field.value}`}><span>{index + 1}</span></button>)}</div></div><aside className="extraction-results" aria-label="Extracted document fields"><div className="results-title"><div><p className="section-kicker">Structured result</p><h4>{activeSample.name}</h4><small>{activeSample.documentType} · {activeSample.provider} · {activeSample.model}</small></div><span>{activeSample.fields.length} fields</span></div><p className="extraction-summary">{activeSample.summary}</p><div className="field-list">{activeSample.fields.map((field, index) => <button className={field.id === activeField.id ? "active" : ""} key={field.id} onClick={() => setActiveFieldId(field.id)}><span className="field-index">{index + 1}</span><span><small>{field.label}</small><strong>{field.value}</strong></span><em>{field.confidence}%</em></button>)}</div><div className="field-focus" aria-live="polite"><div><span>Selected source</span><b>{activeField.confidence}% confidence</b></div><p><strong>{activeField.label}</strong> is highlighted on {activeSample.page.toLowerCase()}. Manual review is required; this does not approve a contract.</p></div></aside></div> : <div className="extraction-waiting" role="status"><div><strong>Preparing visual evidence</strong><p>Rendered pages and per-page errors will appear here. Production extraction remains unavailable.</p></div></div>}
          <p className="extraction-disclosure">PDF and scan pages render in this browser (up to six pages, 850 KB per rendered page). Only rendered page images are sent to the configured provider. Original files and rendered images are not stored; normalized terms, relationships, findings, and review decisions are persisted in D1.</p></section></details>}
          <section className="card findings" id="findings">
            <div className="card-head"><div><p className="section-kicker">Differences</p><h3>Review what changed</h3></div><span className="finding-count">{findings.length} difference{findings.length === 1 ? "" : "s"}</span></div>
            {findings.length ? <>{visibleFindings.map((finding) => {
              const key = findingKey(finding);
              const disposition = findingDispositions[key];
              const chooseDisposition = (next: FindingDisposition, label: string) => {
                setFindingDispositions((current) => ({ ...current, [key]: next }));
                setApproved(false);
                setActivity((items) => [`${label}: ${finding.term} in ${finding.contractName}`, ...items]);
              };
              return <div className="finding" key={key}><span className="warning"><Icon name="warning" /></span><div><strong>{finding.term} mismatch</strong><p>{finding.evidenceName}: {finding.evidenceValue} · {finding.contractName}: {finding.contractValue}</p><button className="source-preview-button" onClick={() => setPreviewFinding(finding)}><Icon name="file" /> Preview annotated sources</button><details className="clause-details"><summary>Compare clauses</summary><div><small>Evidence source</small><blockquote>{finding.evidenceSnippet}</blockquote><small>Contract source</small><blockquote>{finding.contractSnippet}</blockquote></div></details><div className="finding-actions" role="group" aria-label={`Disposition for ${finding.term}`}><button className={disposition === "accept-change" ? "active" : ""} aria-pressed={disposition === "accept-change"} onClick={() => chooseDisposition("accept-change", "Accepted change")}>Accept change</button><button className={disposition === "fix-contract" ? "active" : ""} aria-pressed={disposition === "fix-contract"} onClick={() => chooseDisposition("fix-contract", "Contract fix requested")}>Fix contract</button><button className={disposition === "legal-review" ? "active" : ""} aria-pressed={disposition === "legal-review"} onClick={() => chooseDisposition("legal-review", "Legal review requested")}>Needs legal review</button></div></div></div>;
            })}{findings.length > 3 && <button className="show-more" onClick={() => setShowAllFindings((shown) => !shown)}>{showAllFindings ? "Show fewer differences" : `Show all ${findings.length} differences`}</button>}</> : <div className="empty-state"><strong>{needsContractChoice ? "Choose a governing contract first" : "No comparable differences yet"}</strong><p>{needsContractChoice ? "Use the contract selector above to calculate the correct review." : analysis.pipeline.message}</p></div>}
            <div className="review-footer"><div><strong>{approved ? "Review recorded" : "Finished reviewing?"}</strong><p>{approved ? "All differences and their dispositions remain visible for the review trail." : findings.length && !allFindingsDispositioned ? "Choose a disposition for every difference before recording the review." : "Record that a person reviewed this result. This does not approve the contract."}</p></div><div className="review-actions">{findings.length > 0 && <button className="email-reviewer-button" onClick={() => setReviewerEmailOpen(true)}>Email reviewer</button>}{findings.length > 0 && !allFindingsDispositioned && <button className="bulk-action" onClick={requestFixesForAll}>Request fixes for all</button>}<button className={approved ? "approved-button" : "review-button"} disabled={!canApprove} onClick={() => { setApproved(true); setActivity((items) => ["Human review recorded · just now", ...items]); }}>{approved ? <><Icon name="check" /> Reviewed</> : "Mark reviewed"}</button></div></div>
          </section>
          <details className="advanced-panel activity-panel" id="activity"><summary><span>Activity log</span><small>{activity.length} event{activity.length === 1 ? "" : "s"}</small></summary><section className="activity card"><ul>{activity.map((item, index) => <li key={`${item}-${index}`}><span />{item}</li>)}</ul></section></details>
          </>}
        </div></section>}
      {previewFinding && <FindingSourcePreview finding={previewFinding} evidence={previewEvidence} contract={previewContract} onClose={() => setPreviewFinding(null)} />}
      {reviewerEmailOpen && <ReviewerEmailDialog workspace={workspace} contractName={contract?.name} findings={findings} dispositions={findingDispositions} onClose={() => setReviewerEmailOpen(false)} onDraftOpened={() => setActivity((items) => ["Reviewer email draft opened · just now", ...items])} />}
      <footer><span>© {new Date().getFullYear()} {BRAND}</span><span>Every promise, reconciled.</span></footer>
    </main>
  );
}
