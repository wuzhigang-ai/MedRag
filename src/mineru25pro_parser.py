"""
MinerU 2.5-Pro integrated parser — replaces Docling + remote MinerU SSH.
Uses local GPU (Qwen2-VL 1.2B), pypdfium2 for page rendering, Docling for image extraction.
"""
import torch, pypdfium2, json, os, hashlib, time, re, logging
from PIL import Image
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_PATH = r'C:\Users\bigda\.cache\huggingface\hub\models--opendatalab--MinerU2.5-Pro-2604-1.2B\snapshots\d3f5e08d073c21466bbabe21c71bb1e9c2e595da'

# ── Cached model ──
_model = None
_processor = None

def _get_model():
    global _model, _processor
    if _model is None:
        _model = Qwen2VLForConditionalGeneration.from_pretrained(
            MODEL_PATH, torch_dtype=torch.float16, device_map='auto', trust_remote_code=True)
        _processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    return _model, _processor

# ── Prompts per page type ──
PARSE_PROMPT = (
    "Extract ALL text content from this medical journal page. "
    "For each element, output verbatim text. For tables, preserve row/column structure. "
    "For figures and charts, describe what they show including any data points and captions. "
    "Output as plain text, preserving the original paragraph structure."
)

# ── Text cleaning ──
HEADER_PATTERNS = [
    re.compile(r'JACC\s+Vol\.\s+\d+,\s+No\.\s+\d+,\s+\d{4}\s*\n.+?\d{4}:\d+[-–]\d+', re.IGNORECASE),
    re.compile(r'Seyfarth et al\.\s*\nLVAD Versus IABP in Cardiogenic Shock', re.IGNORECASE),
    re.compile(r'Downloaded from.*?on.*?\d{4}', re.IGNORECASE | re.DOTALL),
    # Generic: repeated journal header lines (e.g. "BRIEF COMMUNICATION Genetics inMedicine")
    re.compile(r'(?:BRIEF|ORIGINAL|CLINICAL|RESEARCH|REVIEW)\s+(?:COMMUNICATION|ARTICLE|REPORT|PAPER|LETTER)\s+[\w\s]+(?:inMedicine|in\s+Medicine|Medicine)', re.IGNORECASE),
    # Generic: running header with journal name + "Vol." + page numbers
    re.compile(r'^[\w\s]+Vol\.\s+\d+.*?\d{4}$', re.MULTILINE | re.IGNORECASE),
]

def _clean_page(text):
    for pat in HEADER_PATTERNS:
        text = pat.sub('', text)
    return text.strip()

# ── Paragraph splitting ──
SECTION_HEADERS = re.compile(
    r'^(METHODS?|RESULTS?|INTRODUCTION|DISCUSSION|CONCLUSIONS?|'
    r'References?|Abbreviations?\s*(and\s+Acronyms)?|'
    r'Study\s+(design|population)|Statistical\s+analysis|'
    r'Table\s+\d+|Figure\s+\d+|WORKS\s+IN\s+PROGRESS)',
    re.IGNORECASE | re.MULTILINE
)

def _split_paragraphs(text, page_idx, target_min=250, target_max=1200):
    chunks = []
    raw_paras = re.split(r'\n\s*\n', text)
    current, current_len = [], 0

    for para in raw_paras:
        para = para.strip()
        if not para: continue
        plen = len(para)

        if SECTION_HEADERS.match(para) and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current, current_len = [para], plen
            continue

        is_table = bool(re.match(r'.+(n\s*=|IQR|\[\d|\(\d+%\)|\d+\s+vs\s+\d+)', para))
        if is_table and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current, current_len = [para], plen
            continue

        if current_len + plen > target_max and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current, current_len = [para], plen
        else:
            current.append(para); current_len += plen

    if current:
        chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})

    result = []
    for c in chunks:
        tlen = len(c['text'])
        if tlen > target_max:
            sentences = re.split(r'(?<=[.!?])\s+', c['text'])
            sub, sublen = [], 0
            for s in sentences:
                if sublen + len(s) > target_max and sublen > target_min:
                    result.append({'text': ' '.join(sub), 'page_idx': page_idx})
                    sub, sublen = [s], len(s)
                else:
                    sub.append(s); sublen += len(s)
            if sub:
                result.append({'text': ' '.join(sub), 'page_idx': page_idx})
        elif tlen < target_min and result:
            result[-1]['text'] += '\n\n' + c['text']
        else:
            result.append(c)
    return result

# ── Entity enrichment (Flash fallback + keywords) ──
MEDICAL_KWS = [
    'LVAD','IABP','Impella','AMI','cardiogenic','shock','myocardial','infarction',
    'LVEF','MODS','SOFA','CPI','mortality','survival','hemodynamic','PCI','CABG',
    'randomized','baseline','primary endpoint','endpoint','ejection fraction',
    'cardiac index','cardiac power','lactate','hemolysis','vasopressor',
    'revascularization','TIMI','angioplasty','stent','bypass'
]

TYPE_RULES = [
    ('baseline_table', ['baseline','characteristics','table 1','table\n1']),
    ('primary_outcome', ['primary endpoint','primary outcome','end point','major endpoint']),
    ('methods_design', ['study design','patient population','inclusion criteria','exclusion']),
    ('safety_outcome', ['adverse','safety','bleeding','complication','mortality rate']),
    ('figure_description', ['figure','fig.','curve','plot','chart','graph']),
    ('abbreviations', ['abbreviation','acronym']),
    ('discussion', ['limitation','finding','suggest','may','might']),
    ('conclusion', ['conclusion','summary','in conclusion']),
    ('references', ['references','cited','et al','journal','doi']),
    ('secondary_outcome', ['secondary','subgroup','sensitivity analysis']),
]

# ── LLM-driven PICO batch classification ──
PICO_TYPES = [
    "primary_outcome", "secondary_outcome", "subgroup_analysis",
    "sensitivity_analysis", "safety_outcome", "methods_design",
    "baseline_table", "outcome_table", "figure_description",
    "discussion", "conclusion", "abbreviations", "references", "other",
]

def _enrich_chunks_batch(chunks: list) -> None:
    """Batch PICO classification via DeepSeek official API. Modifies chunks in-place."""
    if not chunks:
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent / ".env")
        from openai import OpenAI
        import os as _os
        client = OpenAI(
            base_url=_os.getenv("DEEPSEEK_OFFICIAL_BASE_URL"),
            api_key=_os.getenv("DEEPSEEK_OFFICIAL_API_KEY"),
        )
        items = []
        for i, c in enumerate(chunks):
            preview = c["text"][:200].replace("\n", " ").strip()
            items.append(f"[{i}] {preview}")

        prompt = f"""你是医疗文献PICO分类专家。对以下{len(items)}个文本块逐块分类。
类型: primary_outcome(主要终点) | secondary_outcome(次要终点) | subgroup_analysis(亚组分析) | sensitivity_analysis(敏感性分析) | safety_outcome(安全性终点) | methods_design(方法设计) | baseline_table(基线表) | outcome_table(结局表) | figure_description(图表描述) | discussion(讨论) | conclusion(结论) | abbreviations(缩略语) | references(参考文献) | other(其他)

只返回JSON数组: [{{"idx":0,"type":"primary_outcome","entities":["LVAD","mortality"]}}, ...]
{chr(10).join(items)}"""
        resp = client.chat.completions.create(
            model=_os.getenv("DEEPSEEK_OFFICIAL_MODEL", "deepseek-chat"),
            messages=[{"role":"user","content":prompt}],
            temperature=0.1, max_tokens=800, timeout=45.0,
        )
        raw = resp.choices[0].message.content.strip()
        json_match = re.search(r'\[[\s\S]*\]', raw)
        if json_match:
            results = json.loads(json_match.group(0))
            for r in results:
                idx = int(r.get("idx", -1))
                if 0 <= idx < len(chunks):
                    chunks[idx]["chunk_type"] = r.get("type", "other")
                    chunks[idx]["entities"] = r.get("entities", [])[:10]
        logger.info(f"PICO batch classified {len(items)} chunks via DeepSeek")
    except Exception as e:
        logger.warning(f"PICO batch classification failed, using keyword fallback: {e}")
        # Fallback: keyword-based classification
        for c in chunks:
            meta = _enrich_chunk_kw(c["text"])
            c.update(meta)


def _enrich_chunk_kw(text: str) -> dict:
    """Keyword-based fallback enrichment."""
    text_lower = text.lower()
    entities = [kw for kw in MEDICAL_KWS if kw.lower() in text_lower]
    chunk_type = "other"
    for ct, keywords in TYPE_RULES:
        if any(k in text_lower for k in keywords):
            chunk_type = ct
            break
    first_sentence = re.split(r'[.!?]\s+', text)[0]
    one_liner = first_sentence[:150].replace('\n', ' ').strip()
    if not one_liner:
        one_liner = text[:120].replace('\n', ' ').strip()
    return {"chunk_type": chunk_type, "entities": entities[:10], "one_liner": one_liner}


def _enrich_chunk(text, use_flash=False):
    """Single-chunk enrichment (keyword fallback, used when batch fails)."""
    return _enrich_chunk_kw(text)

# ── Doc metadata extraction ──
def _extract_doc_meta(page_texts, doc_name):
    meta = {"title": "", "journal": "", "year": "", "authors": ""}
    if not page_texts: return meta
    p1 = page_texts[0]
    lines = [l.strip() for l in p1.split('\n') if l.strip() and len(l.strip()) > 10]

    # Title
    for line in lines[:10]:
        if any(kw in line.lower() for kw in ['randomized','trial','evaluate','study of','versus','vs.']):
            meta['title'] = line[:200]
            break
    if not meta['title']:
        meta['title'] = doc_name

    # Journal
    for line in lines[:5]:
        if any(kw in line for kw in ['Journal','Cardiology','Lancet','Medicine','BMJ','JAMA','Heart','Circulation']):
            meta['journal'] = line.strip()[:100]
            break

    # Year
    ym = re.search(r'\b(19|20)\d{2}\b', p1[:500])
    if ym: meta['year'] = ym.group(0)

    # Authors
    for line in lines:
        if line.count(',') >= 4 and any(c.isupper() for c in line[:5]):
            meta['authors'] = line[:200]
            break

    return meta

# ── Image extraction via Docling ──
def _extract_images_via_docling(pdf_path, output_dir):
    """Use Docling to extract image files only — not for text parsing."""
    from raganything.parser import DoclingParser
    import shutil
    docparser = DoclingParser()
    images_dir = Path(output_dir) / 'images'
    images_dir.mkdir(parents=True, exist_ok=True)

    img_items = []
    try:
        dl_result = docparser.parse_pdf(pdf_path, output_dir=output_dir)
        if dl_result:
            for item in dl_result:
                if item.get('type') in ('image', 'chart'):
                    img_path = item.get('img_path', '')
                    if img_path and os.path.isfile(img_path):
                        img_name = os.path.basename(img_path)
                        dest = images_dir / img_name
                        if not dest.exists():
                            shutil.copy2(img_path, dest)
                        cap = ' '.join(item.get('image_caption', [])) if item.get('image_caption') else ''
                        img_items.append({
                            'page_idx': max(0, item.get('page_idx', 1) - 1),
                            'img_path': str(dest),
                            'image_url': f'/images/{img_name}',
                            'caption': cap
                        })
    except Exception as e:
        logger.warning(f"Docling image extraction failed: {e}")

    return img_items

# ─── MAIN: Parse PDF with MinerU 2.5-Pro ───
def parse_pdf_25pro(pdf_path, output_dir=None, chunker=None, doc_name_override=None):
    """
    Full pipeline: MinerU 2.5-Pro parsing → paragraph splitting → metadata enrichment.
    Returns path to saved content_list.json.
    """
    pdf_path = Path(pdf_path)
    if output_dir is None:
        output_dir = str(pdf_path.parent / 'output' / 'remote_test')
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'images').mkdir(exist_ok=True)

    doc_name = doc_name_override or pdf_path.stem
    out_path = out_dir / f'{doc_name}_content_list.json'

    # ── Step 1: MinerU 2.5-Pro page-by-page ──
    logger.info(f"Parsing {doc_name} with MinerU 2.5-Pro...")
    model, processor = _get_model()
    pdf = pypdfium2.PdfDocument(str(pdf_path))
    t0 = time.time()
    pages_text = []

    for page_idx in range(len(pdf)):
        page = pdf[page_idx]
        bitmap = page.render(scale=2)
        pil_img = bitmap.to_pil()

        messages = [{'role': 'user', 'content': [
            {'type': 'image', 'image': pil_img},
            {'type': 'text', 'text': PARSE_PROMPT}
        ]}]
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[text], images=[pil_img], return_tensors='pt').to(model.device)

        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=2048, do_sample=False)
        result = processor.decode(output[0], skip_special_tokens=True)
        if 'assistant' in result:
            result = result.split('assistant\n')[-1]

        cleaned = _clean_page(result)
        pages_text.append(cleaned)
        logger.info(f"  Page {page_idx+1}/{len(pdf)}: {len(cleaned)} chars")

    parse_time = time.time() - t0
    logger.info(f"  Parsing: {parse_time:.0f}s ({parse_time/len(pdf):.0f}s/page)")

    # ── Step 2: Split into paragraphs ──
    all_chunks = []
    for page_idx, text in enumerate(pages_text):
        chunks = _split_paragraphs(text, page_idx)
        all_chunks.extend(chunks)
    logger.info(f"  Split: {len(pages_text)} pages → {len(all_chunks)} chunks")

    # ── Step 3: PICO batch classification (LLM) with keyword fallback ──
    _enrich_chunks_batch(all_chunks)
    logger.info(f"  Entities: {sum(len(c.get('entities',[])) for c in all_chunks)} total")

    # ── Step 4: Doc metadata ──
    doc_meta = _extract_doc_meta(pages_text, doc_name)
    logger.info(f"  Doc: {doc_meta['title'][:60]}...")

    # ── Step 5: Image extraction via Docling ──
    page_fig_descs = {}
    for page_idx, text in enumerate(pages_text):
        lines = text.split('\n')
        fig_lines = []
        in_fig = False
        for i, line in enumerate(lines):
            ls = line.strip().lower()
            if any(kw in ls for kw in ['figure ', 'fig. ', 'survival curve', 'time course']):
                fig_lines.append(line.strip())
                for j in range(1, 4):
                    if i+j < len(lines) and lines[i+j].strip():
                        fig_lines.append(lines[i+j].strip())
                break
        if fig_lines:
            page_fig_descs[page_idx] = ' | '.join(fig_lines)

    docling_imgs = _extract_images_via_docling(str(pdf_path), str(out_dir))

    img_chunks = []
    for img in docling_imgs:
        pid = img['page_idx']
        fig_text = page_fig_descs.get(pid, '')
        if not fig_text:
            for adj in [pid+1, pid-1]:
                if adj in page_fig_descs:
                    fig_text = page_fig_descs[adj]; break
        if not fig_text:
            for c in all_chunks:
                if c['page_idx'] == pid and any(kw in c['text'].lower() for kw in ['figure','survival','curve','chart']):
                    fig_text = c['text'][:300]; break
        if not fig_text and img.get('caption'):
            fig_text = f"[图片] {img['caption']}"
        if not fig_text:
            fig_text = f"[图片 p{pid}]"

        img_chunks.append({
            'type': 'image',
            'text': fig_text.strip() if fig_text.strip() else f"[图片 p{pid}]",
            'page_idx': pid,
            'chunk_type': 'figure_description',
            'entities': img.get('caption', '').split()[:5] if img.get('caption') else [],
            'one_liner': img.get('caption', ''),
            'img_path': img['img_path'],
            'image_url': img['image_url'],
            'image_caption': img.get('caption', ''),
            'doc_name': doc_name,
            'doc_title': doc_meta.get('title', ''),
            'journal': doc_meta.get('journal', ''),
            'publication_year': doc_meta.get('year', ''),
            'section_tag': 'results',
        })

    # ── Step 6: Build content_list ──
    content_list = []

    # Section tagger
    section_tag = lambda text: 'unknown'
    if chunker:
        try:
            section_tag = chunker.classify_section
        except: pass

    # Evidence level
    evidence_kws = {1:['meta-analysis'],2:['randomized','rct'],3:['cohort','prospective'],
                    4:['case-control'],5:['case report','case series'],
                    6:['expert consensus','guideline'],7:['review']}
    def infer_ev(text, title):
        combined = (text+' '+title).lower()
        for lv, kws in evidence_kws.items():
            for kw in kws:
                if kw in combined: return lv
        return None

    for c in all_chunks:
        parts = []
        if doc_meta['title']:
            parts.append(f"[文献] {doc_meta['title']}")
        parts.append(c['text'])
        if c.get('one_liner'):
            parts.append(f"[摘要] {c['one_liner']}")
        if c.get('entities'):
            parts.append(f"[实体] {', '.join(c['entities'])}")

        try:
            stag = section_tag(c['text'])
        except:
            stag = 'unknown'
        ev = infer_ev(c['text'], doc_meta.get('title', ''))

        content_list.append({
            'type': 'text',
            'text': '\n'.join(parts),
            'page_idx': c['page_idx'],
            'doc_name': doc_name,
            'doc_title': doc_meta.get('title', ''),
            'journal': doc_meta.get('journal', ''),
            'publication_year': doc_meta.get('year', ''),
            'chunk_type': c.get('chunk_type', 'other'),
            'section_tag': stag,
            'evidence_level': ev,
            'entities': c.get('entities', []),
            'one_liner': c.get('one_liner', ''),
        })

    for ic in img_chunks:
        content_list.append(ic)

    # Save content_list
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(content_list, f, ensure_ascii=False, indent=2)

    # Save raw page texts for parent-page retrieval
    pages_path = out_dir / f'{doc_name}_pages.json'
    with open(pages_path, 'w', encoding='utf-8') as f:
        json.dump(pages_text, f, ensure_ascii=False, indent=2)

    logger.info(f"Saved {len(content_list)} items ({len(all_chunks)}T + {len(img_chunks)}I) + {len(pages_text)} pages → {out_dir}")
    return str(out_path)
