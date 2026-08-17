from pathlib import Path
from PIL import Image

source = Path('icon-512.png')
target = Path('desktop/icon.ico')
image = Image.open(source).convert('RGBA')
image.save(target, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(target)
