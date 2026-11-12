import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readBytes, readText, writeText } from "../api";
import { annotationPath, parseMarks, type PdfColor, type PdfMark, type PdfRect } from "../pdfmarks";

GlobalWorkerOptions.workerSrc = workerUrl;

const swatches: Record<PdfColor, string> = {
  yellow: "rgba(230, 190, 60, 0.45)",
  green: "rgba(90, 180, 110, 0.4)",
  blue: "rgba(80, 140, 220, 0.4)",
  pink: "rgba(220, 110, 150, 0.4)",
};

export function PdfView({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState<PdfColor>("yellow");
  const [status, setStatus] = useState("Loading PDF…");
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    dirty.current = false;
    setSelected(null);
    setStatus("Loading PDF…");
    setDrawn(0);
    let cancel = false;
    void (async () => {
      try {
        const saved = await readText(annotationPath(path)).catch(() => "");
        if (cancel) return;
        setMarks(saved ? parseMarks(saved) : []);
        const encoded = await readBytes(path);
        const binary = atob(encoded);
        const data = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
        const pdf = await getDocument({ data }).promise;
        const root = host.current;
        if (cancel || !root) return;
        root.replaceChildren();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        for (let number = 1; number <= pdf.numPages; number += 1) {
          if (cancel) return;
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: 1.35 });
          const box = document.createElement("div");
          box.className = "pdf-page";
          box.dataset.page = String(number);
          box.style.width = `${viewport.width}px`;
          box.style.height = `${viewport.height}px`;
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const marksLayer = document.createElement("div");
          marksLayer.className = "pdf-marks";
          const textLayer = document.createElement("div");
          textLayer.className = "textLayer";
          box.append(canvas, marksLayer, textLayer);
          root.append(box);
          const transform = pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0];
          await page.render({ canvas, viewport, transform }).promise;
          await new TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayer,
            viewport,
          }).render();
        }
        if (!cancel) setStatus(`${pdf.numPages} pages`);
      } catch (error) {
        if (!cancel) setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancel) setDrawn((value) => value + 1);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [path]);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    for (const page of root.querySelectorAll<HTMLElement>(".pdf-page")) {
      const number = Number(page.dataset.page);
      const layer = page.querySelector(".pdf-marks");
      if (!layer) continue;
      layer.replaceChildren();
      for (const mark of marks) {
        if (mark.page !== number) continue;
        for (const rect of mark.rects) {
          const button = document.createElement("div");
          button.className = mark.id === selected ? "pdf-mark on" : "pdf-mark";
          button.dataset.mark = mark.id;
          button.title = mark.text;
          button.style.left = `${rect.x * 100}%`;
          button.style.top = `${rect.y * 100}%`;
          button.style.width = `${rect.w * 100}%`;
          button.style.height = `${rect.h * 100}%`;
          button.style.background = swatches[mark.color];
          layer.append(button);
        }
      }
    }
  }, [marks, selected, drawn]);

  useEffect(() => {
    if (!dirty.current) return;
    const handle = window.setTimeout(() => {
      void writeText(annotationPath(path), JSON.stringify({ marks }, null, 2)).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [marks, path]);

  const current = marks.find((mark) => mark.id === selected) ?? null;

  function updateMarks(next: PdfMark[]) {
    dirty.current = true;
    setMarks(next);
  }

  function highlight() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setStatus("Select text in the PDF first");
      return;
    }
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node instanceof Element ? node : node.parentElement;
    const page = element?.closest<HTMLElement>(".pdf-page");
    if (!page) return;
    const box = page.getBoundingClientRect();
    const rects = clientRects(range, box);
    const text = selection.toString().trim();
    if (!rects.length || !text) return;
    const mark: PdfMark = {
      id: `mark${Date.now().toString(36)}`,
      page: Number(page.dataset.page),
      text,
      note: "",
      color,
      rects,
    };
    updateMarks([...marks, mark]);
    setSelected(mark.id);
    selection.removeAllRanges();
    setStatus("Highlight saved");
  }

  return (
    <div className="pdf-view">
      <div className="pdf-toolbar">
        <button onClick={highlight} onMouseDown={(event) => event.preventDefault()} type="button">Highlight</button>
        {(Object.keys(swatches) as PdfColor[]).map((item) => (
          <button
            aria-label={item}
            className={color === item ? "swatch on" : "swatch"}
            key={item}
            onClick={() => {
              setColor(item);
              if (!current) return;
              updateMarks(marks.map((mark) => (mark.id === current.id ? { ...mark, color: item } : mark)));
            }}
            style={{ background: swatches[item] }}
            type="button"
          />
        ))}
        <button
          disabled={!current}
          onClick={() => {
            if (!current) return;
            updateMarks(marks.filter((mark) => mark.id !== current.id));
            setSelected(null);
          }}
          type="button"
        >
          Delete
        </button>
        <span className="muted">{status}</span>
      </div>
      <div
        className="pdf-pages"
        onClick={(event) => {
          const page = event.target instanceof Element ? event.target.closest<HTMLElement>(".pdf-page") : null;
          if (!page || (window.getSelection()?.isCollapsed === false)) return;
          const box = page.getBoundingClientRect();
          const x = (event.clientX - box.left) / box.width;
          const y = (event.clientY - box.top) / box.height;
          const hit = marks.find(
            (mark) =>
              mark.page === Number(page.dataset.page) &&
              mark.rects.some((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h),
          );
          setSelected(hit?.id ?? null);
        }}
        ref={host}
      />
      <label className="pdf-note">
        Note
        <textarea
          disabled={!current}
          onChange={(event) => {
            if (!current) return;
            const note = event.target.value;
            updateMarks(marks.map((mark) => (mark.id === current.id ? { ...mark, note } : mark)));
          }}
          placeholder={current ? current.text : "Select a highlight to add a note"}
          value={current?.note ?? ""}
        />
      </label>
    </div>
  );
}

function clientRects(range: Range, box: DOMRect): PdfRect[] {
  return [...range.getClientRects()]
    .map((rect) => ({
      x: (rect.left - box.left) / box.width,
      y: (rect.top - box.top) / box.height,
      w: rect.width / box.width,
      h: rect.height / box.height,
    }))
    .filter((rect) => rect.w > 0.002 && rect.h > 0.002);
}
