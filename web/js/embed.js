// Optional on-device matching. Runs in the visitor's browser tab (WebAssembly, no WebGPU needed).
// A small multilingual sentence-embedding model (about 120 MB, downloaded once and cached by the browser) turns each bookmark
// title and each activity (name, keywords, domain vocabulary) into a vector. A title is routed to an activity when the cosine
// similarity is high enough. Bookmark text stays in this tab; only the model weights are downloaded.
const TF = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm";
const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const THRESHOLD = 0.5;

export const supported = () => typeof WebAssembly !== "undefined";

let extP = null;
export function loadEmbedder(onProgress) {
  if (!extP) {
    extP = (async () => {
      const T = await import(TF);
      return T.pipeline("feature-extraction", MODEL, {
        dtype: "q8",
        progress_callback: (p) => { if (p.status === "progress" && onProgress) onProgress(Math.min(1, (p.progress || 0) / 100)); },
      });
    })().catch((e) => { extP = null; throw e; });
  }
  return extP;
}

const embed = async (ext, texts) => (await ext(texts, { pooling: "mean", normalize: true })).tolist();

// One vector per activity name, keyword and vocabulary term
export async function buildIndex(ext, kb, vocab) {
  const labels = [], texts = [];
  for (const a of kb.filter((x) => !x.fallback_only)) {
    for (const t of [a.activity, ...(a.keywords || []), ...(vocab[a.activity] || [])]) { labels.push(a.activity); texts.push(t); }
  }
  const vecs = [];
  for (let i = 0; i < texts.length; i += 32) vecs.push(...(await embed(ext, texts.slice(i, i + 32))));
  return { labels, vecs };
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Returns [{item, activity, score}] for items whose best activity reaches the threshold. Others are left alone, never guessed.
export async function matchItems(ext, index, items, { threshold = THRESHOLD, limit = 400, onStep = () => {} } = {}) {
  const todo = items.slice(0, limit), out = [];
  for (let i = 0; i < todo.length; i += 16) {
    const batch = todo.slice(i, i + 16);
    const vs = await embed(ext, batch.map((it) => it.title.slice(0, 160)));
    vs.forEach((v, k) => {
      let best = null, score = -1;
      index.vecs.forEach((a, j) => { const d = dot(v, a); if (d > score) { score = d; best = index.labels[j]; } });
      if (score >= threshold) out.push({ item: batch[k], activity: best, score });
    });
    onStep(Math.min(i + 16, todo.length), todo.length);
  }
  return out;
}
