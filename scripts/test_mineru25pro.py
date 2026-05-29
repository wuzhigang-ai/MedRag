"""Test MinerU 2.5-Pro with bbox output for image regions."""
import torch, pypdfium2, json, os, re, hashlib, time, base64
from PIL import Image
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from pathlib import Path

MODEL_PATH = r'C:\Users\bigda\.cache\huggingface\hub\models--opendatalab--MinerU2.5-Pro-2604-1.2B\snapshots\d3f5e08d073c21466bbabe21c71bb1e9c2e595da'
PDF_PATH = 'uploads/seyfarth2008.pdf'
OUTPUT_DIR = Path('output/remote_test')
IMAGES_DIR = OUTPUT_DIR / 'images'
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

print('Loading model...')
t0 = time.time()
model = Qwen2VLForConditionalGeneration.from_pretrained(
    MODEL_PATH, torch_dtype=torch.float16, device_map='auto', trust_remote_code=True)
processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
print(f'Loaded in {time.time()-t0:.1f}s')

pdf = pypdfium2.PdfDocument(PDF_PATH)
print(f'PDF: {len(pdf)} pages')

PROMPT = """Parse this medical journal page. Identify EVERY distinct element and output as JSON:

For TEXT paragraphs: {"type":"text","text":"<verbatim>","page_idx":PAGE}
For TABLES: {"type":"table","caption":"<caption>","body":"<structured rows>","page_idx":PAGE}
For FIGURES/CHARTS/IMAGES: {"type":"image","caption":"<caption>","description":"<what the chart/figure shows>","bbox":[x1,y1,x2,y2],"page_idx":PAGE}
  - bbox uses 0-1000 scale (fraction*1000 of page width/height)

Return: {"items": [...]}"""

content_list = []
start_page = 0
end_page = len(pdf)
img_count = 0

for page_idx in range(start_page, end_page):
    page = pdf[page_idx]
    bitmap = page.render(scale=2)
    pil_img = bitmap.to_pil()

    messages = [{'role': 'user', 'content': [
        {'type': 'image', 'image': pil_img},
        {'type': 'text', 'text': PROMPT.replace('PAGE', str(page_idx))}
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

    print(f'\nPage {page_idx+1}/{len(pdf)}: {elapsed:.1f}s, {len(result)} chars')

    # Parse JSON
    try:
        # Extract JSON block if wrapped in markdown
        json_match = re.search(r'\{[\s\S]*"items"[\s\S]*\}', result)
        if json_match:
            parsed = json.loads(json_match.group(0))
        else:
            # Try raw
            parsed = json.loads(result)

        items = parsed.get('items', [])
        texts, tables, images = 0, 0, 0
        for item in items:
            t = item.get('type', 'text')
            item['page_idx'] = page_idx

            # Crop image from page if bbox provided
            if t == 'image' and 'bbox' in item:
                bbox = item['bbox']
                x1 = int(bbox[0] * w / 1000)
                y1 = int(bbox[1] * h / 1000)
                x2 = int(bbox[2] * w / 1000)
                y2 = int(bbox[3] * h / 1000)
                cropped = pil_img.crop((x1, y1, x2, y2))
                img_hash = hashlib.md5(cropped.tobytes()).hexdigest()[:16]
                img_name = f'img_p{page_idx}_{img_hash}.png'
                img_path = IMAGES_DIR / img_name
                cropped.save(str(img_path))
                item['img_path'] = str(img_path)
                item['image_url'] = f'/images/{img_name}'
                images += 1
                img_count += 1
            elif t == 'table':
                tables += 1
            else:
                texts += 1

            content_list.append(item)

        print(f'  texts={texts}, tables={tables}, images={images}')
    except Exception as e:
        print(f'  JSON parse failed: {e}')
        # Fallback: treat as plain text
        content_list.append({
            'type': 'text', 'text': result, 'page_idx': page_idx
        })

# Save
out_path = OUTPUT_DIR / 'seyfarth2008_25pro_content_list.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(content_list, f, ensure_ascii=False, indent=2)

print(f'\nDone. {len(content_list)} items -> {out_path}')
print(f'Images cropped: {img_count}')

# Quality summary
from collections import Counter
types = Counter(i.get('type','?') for i in content_list)
print(f'Content types: {dict(types)}')
imgs_with_bbox = sum(1 for i in content_list if i.get('type')=='image' and i.get('bbox'))
imgs_with_caption = sum(1 for i in content_list if i.get('type')=='image' and i.get('image_caption'))
print(f'Images with bbox: {imgs_with_bbox}, with caption: {imgs_with_caption}')
