"""Serialize model selection and gateway fault updates on this Windows host."""
import json,time,uuid,msvcrt
from pathlib import Path

def _open(lock,deadline):
 # Antivirus/minifilter on this host can deny the first concurrent open of a
 # freshly created lock file; retry inside the same 3s budget instead of failing.
 while True:
  try:return lock.open('a+b')
  except PermissionError:
   if time.monotonic()>=deadline:raise
   time.sleep(.02)

def update(path,change):
 path=Path(path);lock=path.with_suffix('.lock');deadline=time.monotonic()+3
 with _open(lock,deadline) as handle:
  handle.seek(0,2)
  if handle.tell()==0:handle.write(b'0');handle.flush()
  while True:
   try:handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1);break
   except OSError:
    if time.monotonic()>=deadline:raise TimeoutError('model_config_busy') from None
    time.sleep(.025)
  try:
   cfg=json.loads(path.read_text(encoding='utf-8-sig'));change(cfg)
   tmp=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
   tmp.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(path)
   return cfg
  finally:handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
