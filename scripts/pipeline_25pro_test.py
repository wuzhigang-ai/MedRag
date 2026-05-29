"""MinerU 2.5-Pro full pipeline: parse → split → enrich → content_list."""
import sys, torch, pypdfium2, json, os, hashlib, time, re
from PIL import Image
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from pathlib import Path
from collections import Counter

MODEL_PATH = r'C:\Users\bigda\.cache\huggingface\hub\models--opendatalab--MinerU2.5-Pro-2604-1.2B\snapshots\d3f5e08d073c21466bbabe21c71bb1e9c2e595da'
PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else 'uploads/seyfarth2008.pdf'
OUTPUT_DIR = Path('output/remote_test')
IMAGES_DIR = OUTPUT_DIR / 'images'

# ── Page header removal regex ──
HEADER_PATTERNS = [
    re.compile(r'JACC\s+Vol\.\s+\d+,\s+No\.\s+\d+,\s+\d{4}\s*\n.+?\d{4}:\d+[-–]\d+', re.IGNORECASE),
    re.compile(r'Seyfarth et al\.\s*\nLVAD Versus IABP in Cardiogenic Shock', re.IGNORECASE),
]

def clean_page_text(text):
    for pat in HEADER_PATTERNS:
        text = pat.sub('', text)
    # Remove leading empty lines
    text = text.strip()
    return text

# ── Paragraph splitter ──
SECTION_HEADERS = re.compile(
    r'^(METHODS?|RESULTS?|INTRODUCTION|DISCUSSION|CONCLUSIONS?|'
    r'References?|Abbreviations?\s*(and\s+Acronyms)?|'
    r'Study\s+(design|population)|Statistical\s+analysis|'
    r'Table\s+\d+|Figure\s+\d+|'
    r'WORKS\s+IN\s+PROGRESS)',
    re.IGNORECASE | re.MULTILINE
)

def split_paragraphs(text, page_idx, target_min=250, target_max=1200):
    """Split page text into chunks. Tables stay as complete blocks."""
    chunks = []
    raw_paras = re.split(r'\n\s*\n', text)
    current = []
    current_len = 0

    for para in raw_paras:
        para = para.strip()
        if not para:
            continue
        para_len = len(para)

        # New section → flush
        if SECTION_HEADERS.match(para) and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current = [para]
            current_len = para_len
            continue

        # Table content (detected by row patterns) → keep intact, flush previous first
        is_table = bool(re.match(r'.+(n\s*=|IQR|\[\d|\(\d+%\)|\d+\s+vs\s+\d+)', para))
        if is_table and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current = [para]
            current_len = para_len
            continue

        if current_len + para_len > target_max and current_len > target_min:
            chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})
            current = [para]
            current_len = para_len
        else:
            current.append(para)
            current_len += para_len

    if current:
        chunks.append({'text': '\n\n'.join(current), 'page_idx': page_idx})

    # Handle very long/short chunks
    result = []
    for c in chunks:
        tlen = len(c['text'])
        if tlen > target_max:
            # Split by sentence
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
            # Merge with previous
            result[-1]['text'] += '\n\n' + c['text']
        else:
            result.append(c)

    return result

# ── Flash metadata enrichment ──
def enrich_chunks(chunks):
    """Use Baidu Flash to add chunk_type, entities, one_liner to each chunk."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / '.env')
    from openai import OpenAI

    client = OpenAI(
        base_url=os.getenv('BAIDU_BASE_URL'),
        api_key=os.getenv('BAIDU_API_KEY')
    )
    model = os.getenv('BAIDU_FLASH_MODEL', 'deepseek-v4-flash')

    enriched = []
    for i, chunk in enumerate(chunks):
        text = chunk['text'][:600]  # Use first 600 chars for classification
        prompt = f"""分析这段医学文献文本, 返回JSON:
{{
  "chunk_type": "baseline_table|methods_design|primary_outcome|secondary_outcome|safety_outcome|subgroup_analysis|figure_description|abbreviations|discussion|conclusion|references|other",
  "entities": ["实体1", "实体2", ...],  // 提到的关键医学概念/药物/检查/指标
  "one_liner": "一句话中文摘要"
}}

文本:
{text}"""

        try:
            resp = client.chat.completions.create(
                model=model, messages=[{'role':'user','content':prompt}],
                temperature=0.1, max_tokens=200, timeout=15.0
            )
            result = resp.choices[0].message.content
            # Extract JSON
            json_match = re.search(r'\{[\s\S]*\}', result)
            if json_match:
                meta = json.loads(json_match.group(0))
            else:
                meta = {"chunk_type": "other", "entities": [], "one_liner": ""}
        except Exception as e:
            # Fallback: extract entities from text patterns
            entities = []
            for kw in ['LVAD','IABP','Impella','AMI','cardiogenic','shock','myocardial',
                       'LVEF','MODS','SOFA','CPI','mortality','survival','hemodynamic',
                       'PCI','CABG','randomized','baseline','primary endpoint']:
                if kw.lower() in text.lower():
                    entities.append(kw)
            chunk_type = 'other'
            for kw_map in [('baseline_table',['baseline','characteristics','table 1']),
                          ('primary_outcome',['primary endpoint','primary outcome','end point']),
                          ('methods_design',['study design','patient population','randomized']),
                          ('safety_outcome',['adverse','safety','bleeding','complication']),
                          ('figure_description',['figure','curve','plot','chart'])]:
                if any(k in text.lower() for k in kw_map[1]):
                    chunk_type = kw_map[0]; break
            meta = {"chunk_type": chunk_type, "entities": entities[:8],
                    "one_liner": text[:120].replace('\n',' ')}

        chunk['chunk_type'] = meta.get('chunk_type', 'other')
        chunk['entities'] = meta.get('entities', [])
        chunk['one_liner'] = meta.get('one_liner', '')
        enriched.append(chunk)

        if (i+1) % 5 == 0:
            print(f'  Enriched {i+1}/{len(chunks)} chunks...')

    return enriched

# ════════════════════════════════════════════
# MAIN PIPELINE
# ════════════════════════════════════════════
if __name__ == '__main__':
    import sys
    print("="*60)
    print(" MinerU 2.5-Pro 完整管线测试")
    print("="*60)

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # ── Step 1: MinerU 2.5-Pro parsing ──
    print('\n[1/4] MinerU 2.5-Pro 解析...')
    t0 = time.time()
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_PATH, torch_dtype=torch.float16, device_map='auto', trust_remote_code=True)
    processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    print(f'  模型加载: {time.time()-t0:.1f}s')

    pdf = pypdfium2.PdfDocument(PDF_PATH)
    doc_name = Path(PDF_PATH).stem
    pages_text = []
    total_time = 0

    PROMPT = "Extract ALL text content from this document page. Include tables as structured text with rows and columns. Describe any figures or charts you see. Output as plain text."

    for page_idx in range(len(pdf)):
        page = pdf[page_idx]
        bitmap = page.render(scale=2)
        pil_img = bitmap.to_pil()

        messages = [{'role':'user','content':[{'type':'image','image':pil_img},{'type':'text','text':PROMPT}]}]
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[text], images=[pil_img], return_tensors='pt').to(model.device)

        t1 = time.time()
        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=2048, do_sample=False)
        elapsed = time.time() - t1
        total_time += elapsed

        result = processor.decode(output[0], skip_special_tokens=True)
        if 'assistant' in result:
            result = result.split('assistant\n')[-1]

        cleaned = clean_page_text(result)
        pages_text.append(cleaned)
        print(f'  页{page_idx+1}: {elapsed:.0f}s, {len(cleaned)} chars')

    print(f'  解析: {total_time:.0f}s / {len(pdf)} 页 = {total_time/len(pdf):.0f}s/页')

    # ── Step 2: Split paragraphs ──
    print(f'\n[2/4] 段落拆分...')
    all_chunks = []
    for page_idx, text in enumerate(pages_text):
        chunks = split_paragraphs(text, page_idx)
        all_chunks.extend(chunks)

    avg_len = sum(len(c['text']) for c in all_chunks) // max(len(all_chunks), 1)
    print(f'  拆分: {len(pages_text)} 页 → {len(all_chunks)} 块, 平均 {avg_len} 字/块')
    for c in all_chunks[:5]:
        print(f'    [{c["page_idx"]}] {c["text"][:80]}...')

    # ── Step 3: Enrich metadata ──
    print(f'\n[3/4] Flash 元数据富化...')
    all_chunks = enrich_chunks(all_chunks)

    # Show enrichment results
    types = Counter(c.get('chunk_type','?') for c in all_chunks)
    total_entities = sum(len(c.get('entities',[])) for c in all_chunks)
    print(f'  chunk_type 分布: {dict(types)}')
    print(f'  总实体数: {total_entities}')
    for c in all_chunks[:3]:
        print(f'    [{c["chunk_type"]}] entities={c.get("entities",[])} one_liner=\"{c.get("one_liner","")}\"')

    # ── Step 4: Extract images via Docling (page 0-indexed) ──
    print(f'\n[4/4] Docling 图片提取 + 元数据补全...')
    from raganything.parser import DoclingParser
    docparser = DoclingParser()
    dl_result = docparser.parse_pdf(PDF_PATH, output_dir='output/remote_test')

    # Extract doc-level metadata from first page text
    doc_meta = {"title": "", "authors": "", "journal": "", "year": ""}
    if pages_text:
        p1 = pages_text[0]
        # Title: first substantive line after journal header
        lines = [l.strip() for l in p1.split('\n') if l.strip() and len(l.strip()) > 10]
        for line in lines[:10]:
            if any(kw in line.lower() for kw in ['randomized','trial','evaluate','study of','versus','vs.']):
                doc_meta['title'] = line[:200]
                break
        # Journal: usually first line
        for line in lines[:5]:
            if any(kw in line for kw in ['Journal','Cardiology','Lancet','Medicine','BMJ','JAMA']):
                doc_meta['journal'] = line.strip()[:100]
                break
        # Year: 4-digit year in first few lines
        year_match = re.search(r'\b(19|20)\d{2}\b', p1[:500])
        if year_match:
            doc_meta['year'] = year_match.group(0)
        # Authors: line with many commas and initials
        for line in lines:
            if line.count(',') >= 4 and any(c.isupper() for c in line[:5]):
                doc_meta['authors'] = line[:200]
                break

    print(f"  文献元数据: title={doc_meta['title'][:60]}...")
    print(f"  journal={doc_meta['journal']}, year={doc_meta['year']}")

    # Use chunker for section tags
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from src.medical_chunker import MedicalChunker
    chunker = MedicalChunker()
    # Evidence level keywords for quick inference
    EVIDENCE_KEYWORDS = {
        1: ['meta-analysis', 'meta analysis', 'systematic review'],
        2: ['randomized', 'randomised', 'rct'],
        3: ['cohort', 'prospective study'],
        4: ['case-control', 'case control'],
        5: ['case report', 'case series'],
        6: ['expert consensus', 'guideline', 'expert opinion'],
        7: ['review', 'narrative review']
    }
    def infer_evidence(text, title):
        combined = (text + ' ' + title).lower()
        for level, keywords in EVIDENCE_KEYWORDS.items():
            for kw in keywords:
                if kw in combined:
                    return level
        return None

    # Pre-scan: extract figure descriptions from 25Pro page texts
    page_fig_descs = {}  # {page_idx: "Figure description text"}
    for page_idx, text in enumerate(pages_text):
        lines = text.split('\n')
        fig_lines = []
        in_fig = False
        for i, line in enumerate(lines):
            ls = line.strip().lower()
            if any(kw in ls for kw in ['figure ', 'fig. ', 'figure\n', 'survival curve', 'time course']):
                in_fig = True
                fig_lines.append(line.strip())
                # Grab next 3 lines too (figure sub-descriptions like (A), (B))
                for j in range(1, 4):
                    if i+j < len(lines) and lines[i+j].strip():
                        fig_lines.append(lines[i+j].strip())
                break
        if fig_lines:
            page_fig_descs[page_idx] = ' | '.join(fig_lines)

    img_chunks = []
    if dl_result:
        for item in dl_result:
            if item.get('type') in ('image', 'chart'):
                img_path = item.get('img_path', '')
                if img_path and os.path.isfile(img_path):
                    import shutil
                    img_name = os.path.basename(img_path)
                    dest = IMAGES_DIR / img_name
                    if not dest.exists():
                        shutil.copy2(img_path, dest)

                    # Docling uses 1-indexed pages → convert to 0-indexed
                    page_idx = max(0, item.get('page_idx', 1) - 1)
                    cap = ' '.join(item.get('image_caption', [])) if item.get('image_caption') else ''

                    # Priority: 25Pro description > adjacent page description > caption > placeholder
                    fig_text = page_fig_descs.get(page_idx, '')
                    if not fig_text:
                        # Check adjacent pages
                        for adj in [page_idx+1, page_idx-1]:
                            if adj in page_fig_descs:
                                fig_text = page_fig_descs[adj]
                                break
                    if not fig_text:
                        # Fallback: search all chunks for figure mentions on this page
                        for c in all_chunks:
                            if c['page_idx'] == page_idx and any(kw in c['text'].lower()
                                   for kw in ['figure', 'survival', 'curve', 'chart']):
                                fig_text = c['text'][:300]
                                break
                    if not fig_text and cap:
                        fig_text = f'[图片] {cap}'
                    if not fig_text:
                        fig_text = f'[图片 p{page_idx}]'

                    img_chunks.append({
                        'text': fig_text.strip() if fig_text.strip() else f'[图片 p{page_idx}]',
                        'page_idx': page_idx,
                        'chunk_type': 'figure_description',
                        'entities': [],
                        'one_liner': cap,
                        'img_path': str(dest),
                        'image_url': f'/images/{img_name}',
                        'image_caption': cap
                    })

    print(f'  图片: {len(img_chunks)} 张')
    for ic in img_chunks:
        print(f'    p{ic["page_idx"]}: {ic["image_caption"][:60]}')

    # ── Build final content_list ──
    content_list = []

    # Text chunks
    for c in all_chunks:
        # Add section tag + evidence level via chunker
        try:
            section_tag = chunker.classify_section(c['text'])
        except:
            section_tag = 'unknown'
        evidence = infer_evidence(c['text'], doc_meta.get('title', ''))

        # Build enriched text for FAISS: title context + text + summary + entities
        parts = []
        if doc_meta['title']:
            parts.append(f'[文献] {doc_meta["title"]}')
        parts.append(c['text'])
        if c.get('one_liner'):
            parts.append(f'[摘要] {c["one_liner"]}')
        if c.get('entities'):
            parts.append(f'[实体] {", ".join(c["entities"])}')

        content_list.append({
            'type': 'text',
            'text': '\n'.join(parts),
            'page_idx': c['page_idx'],
            'doc_name': doc_name,
            'doc_title': doc_meta.get('title', ''),
            'journal': doc_meta.get('journal', ''),
            'publication_year': doc_meta.get('year', ''),
            'chunk_type': c.get('chunk_type', 'other'),
            'section_tag': section_tag,
            'evidence_level': evidence,
            'entities': c.get('entities', []),
            'one_liner': c.get('one_liner', ''),
        })

    # Image chunks
    for ic in img_chunks:
        content_list.append({
            'type': 'image',
            'text': ic['text'],
            'page_idx': ic['page_idx'],
            'doc_name': doc_name,
            'doc_title': doc_meta.get('title', ''),
            'journal': doc_meta.get('journal', ''),
            'publication_year': doc_meta.get('year', ''),
            'chunk_type': 'figure_description',
            'section_tag': 'results',
            'entities': ic.get('entities', []),
            'one_liner': ic.get('one_liner', ''),
            'img_path': ic.get('img_path', ''),
            'image_url': ic.get('image_url', ''),
            'image_caption': ic.get('image_caption', ''),
        })

    # Save
    out_path = OUTPUT_DIR / f'{doc_name}_25pro_full_content_list.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(content_list, f, ensure_ascii=False, indent=2)

    print(f'\n{"="*60}')
    print(f' 完成! {out_path}')
    print(f' {len(all_chunks)} 文本块 + {len(img_chunks)} 图片块')
    print(f' 平均文本块: {avg_len} 字')
    print(f' chunk_type 分布: {dict(types)}')
    print(f' 总实体数: {total_entities}')
    print(f'{"="*60}')
