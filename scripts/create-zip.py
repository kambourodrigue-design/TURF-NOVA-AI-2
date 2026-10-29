import os
import zipfile

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
public_dir = os.path.join(root_dir, 'public')
os.makedirs(public_dir, exist_ok=True)

# 1. Complete Source Code ZIP for Vercel / Cloudflare Pages (Git deploy)
source_zip_path = os.path.join(public_dir, 'nafora-source.zip')
exclude_dirs = {'.git', 'node_modules', '.cache', 'dev-dist'}
exclude_files = {'nafora-source.zip', 'nafora-dist.zip'}

with zipfile.ZipFile(source_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Filter out excluded directories
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for filename in filenames:
            if filename in exclude_files:
                continue
            file_path = os.path.join(dirpath, filename)
            arcname = os.path.relpath(file_path, root_dir)
            zipf.write(file_path, arcname)

print(f"Created source zip: {source_zip_path} ({os.path.getsize(source_zip_path)} bytes)")

# 2. Pre-built Dist ZIP for Direct Drag & Drop on Cloudflare Pages / Netlify
dist_dir = os.path.join(root_dir, 'dist')
if os.path.exists(dist_dir):
    dist_zip_path = os.path.join(public_dir, 'nafora-dist.zip')
    with zipfile.ZipFile(dist_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for dirpath, dirnames, filenames in os.walk(dist_dir):
            for filename in filenames:
                file_path = os.path.join(dirpath, filename)
                arcname = os.path.relpath(file_path, dist_dir)
                zipf.write(file_path, arcname)
    print(f"Created dist zip: {dist_zip_path} ({os.path.getsize(dist_zip_path)} bytes)")
