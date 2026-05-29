"""MinerU 2.5-Pro: Text extraction + Docling: Image extraction = Best combo."""
import torch, pypdfium2, json, os, hashlib, time
from PIL import Image
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from pathlib import Path
from collections import Counter

MODEL_PATH = r'C:\Users\bigda\.cache\huggingface\hub\models--opendatalab--MinerU2.5-Pro-2604-1.2B\snapshots\d3f5e08d073c21466bbabe21c71bb1e9c2e595da'
PDF_PATH = 'uploads/seyfarth2008.pdf'
OUTPUT_DIR = Path('output/remote_test')
IMAGES_DIR = OUTPUT_DIR / 'images'
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

print('Loading MinerU 2.5-Pro...')
t0 = time.time()
model = Qwen2VLForConditionalGeneration.from_pretrained(
    MODEL_PATH, torch_dtype=torch.float16, device_map='auto', trust_remote_code=True)
processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
print(f'Loaded in {time.time()-t0:.1f}s')

pdf = pypdfium2.PdfDocument(PDF_PATH)
print(f'PDF: {len(pdf)} pages')

# Simple, proven prompt for text extraction
PROMPT = "Extract ALL text content from this document page. Include tables as structured text with rows and columns. Describe any figures or charts you see. Output as plain text."

content_list = []
total_text_chars = 0

for page_idx in range(len(pdf)):
    page = pdf[page_idx]
    bitmap = page.render(scale=2)
    pil_img = bitmap.to_pil()

    messages = [{'role': 'user', 'content': [
        {'type': 'image', 'image': pil_img},
        {'type': 'text', 'text': PROMPT}
    ]}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], images=[pil_img], return_tensors='pt').to(model.device)

    t1 = time.time()
    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=2048, do_sample=False)
    elapsed = time.time() - t1

    result = processor.decode(output[0], skip_special_tokens=True)
    if 'assistant' in result:
        result = result.split('assistant\n')[-1]

    result_len = len(result)
    total_text_chars += result_len
    content_list.append({
        'type': 'text',
        'text': result,
        'page_idx': page_idx,
        '_engine': 'mineru25pro'
    })
    print(f'Page {page_idx+1}: {elapsed:.1f}s, {result_len} chars')
    print(f'  Preview: {result[:120]}...')

# ── Extract images via Docling ──
print('\nExtracting images via Docling...')
from raganything.parser import DoclingParser
docparser = DoclingParser()
os.makedirs('output/remote_test', exist_ok=True)
dl_result = docparser.parse_pdf(PDF_PATH, output_dir='output/remote_test')

img_items = []
if dl_result:
    for item in dl_result:
        if item.get('type') in ('image', 'chart'):
            img_path = item.get('img_path', '')
            if img_path and os.path.isfile(img_path):
                img_name = os.path.basename(img_path)
                dest = IMAGES_DIR / img_name
                if not dest.exists():
                    import shutil
                    shutil.copy2(img_path, dest)
                cap = ' '.join(item.get('image_caption', [])) if item.get('image_caption') else ''
                img_items.append({
                    'type': 'image',
                    'img_path': str(dest),
                    'image_url': f'/images/{img_name}',
                    'image_caption': cap,
                    'page_idx': item.get('page_idx', 0),
                    '_engine': 'docling_image'
                })

print(f'Docling: {len(img_items)} images extracted')
for img in img_items:
    print(f'  p{img["page_idx"]}: {img.get("image_caption","")[:60]}')

# ── Merge ──
all_items = content_list + img_items
all_items.sort(key=lambda x: (x['page_idx'], 0 if x['type']=='text' else 1))

out_path = OUTPUT_DIR / 'seyfarth2008_25pro_content_list.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(all_items, f, ensure_ascii=False, indent=2)

print(f'\nDone. {len(all_items)} items ({len(content_list)} text + {len(img_items)} images)')
print(f'Total text chars: {total_text_chars}')
print(f'Images: {len(img_items)}')

# ── Quality check ──
types = Counter(i.get('type','?') for i in all_items)
img_with_cap = sum(1 for i in img_items if i.get('image_caption'))
print(f'\nContent types: {dict(types)}')
print(f'Images with captions: {img_with_cap}/{len(img_items)}')
print(f'Avg text per page: {total_text_chars//len(content_list)} chars')
