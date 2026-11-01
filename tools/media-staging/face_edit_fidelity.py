"""Original-composition fidelity checker for two Fang Yuan meme reference photos.
This does NOT create a Fang Yuan face, endorse the depicted person, or approve rights.
It only produces private ROI guides and independently checks edited candidate fidelity.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def digest(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def load_targets(path:Path)->dict:
    doc=json.loads(path.read_text(encoding='utf-8-sig'))
    return {row['id']:row for row in doc['targets']}
def make_mask(size,polygon):
    image=Image.new('L',size,0)
    ImageDraw.Draw(image).polygon([tuple(v) for v in polygon],fill=255)
    return np.asarray(image)>0
def check_scope(original:Image.Image,candidate:Image.Image,polygon)->dict:
    if original.size!=candidate.size:
        return {'scope_pass':False,'reason':'changed_canvas_dimensions',
            'original_size':original.size,'candidate_size':candidate.size}
    origin=np.asarray(original.convert('RGB'),dtype=np.float32)
    edited=np.asarray(candidate.convert('RGB'),dtype=np.float32)
    mask=make_mask(original.size,polygon)
    delta=np.abs(edited-origin).mean(axis=2)
    if not mask.any() or (~mask).sum()<100:
        raise ValueError('Invalid or nearly complete ROI')
    outside=delta[~mask];inside=delta[mask]
    mean_out=float(outside.mean())
    nonlocal_change=float(np.mean(outside>20.0))
    change_inside=float(np.mean(inside>9.0))
    mean_inside=float(inside.mean())
    # JPEG re-encodes cause slight background change, but wholesale redraws must fail.
    background_ok=mean_out<=4.5 and nonlocal_change<=0.02
    face_changed=change_inside>=0.035 and mean_inside>=3.
    return {'scope_pass':bool(background_ok and face_changed),
       'background_preserved':bool(background_ok),'face_region_changed':bool(face_changed),
       'outside_avg_rgb_delta':round(mean_out,4),
       'outside_pixels_delta_gt_20_ratio':round(nonlocal_change,5),
       'inside_pixels_delta_gt_9_ratio':round(change_inside,5),
       'inside_avg_rgb_delta':round(mean_inside,4),
       'note':'Scope-only automated QA; image rights, expression quality and Fang Yuan likeness need separate visual review.'}
def prepare(*,source_dir:Path,index_file:Path,targets_file:Path,out:Path)->dict:
    if out.exists():raise ValueError('Do not overwrite previous guide directory')
    owner=json.loads((out.parent/'.fangyuan-media-staging-root.json').read_text(encoding='utf-8-sig'))
    if owner.get('purpose')!='isolated-fangyuan-media-staging':raise ValueError('Not media-task-owned output')
    manifest=json.loads(index_file.read_text(encoding='utf-8-sig'))
    known={Path(x['path']).name:x for x in manifest['items']}
    targets=load_targets(targets_file)
    # Fail before producing anything if input geometry/hash drifted.
    verified=[]
    for x in targets.values():
        name=x['source_file']
        image_path=(source_dir/name).resolve()
        if not image_path.is_relative_to(source_dir.resolve()):
            raise ValueError('Attempt to escape source folder')
        if not image_path.is_file() or name not in known:
            raise ValueError('Source file not present in verified index')
        if known[name]['sha256']!=digest(image_path):
            raise ValueError('Original source checksum mismatch')
        with Image.open(image_path) as im:
            if list(im.size)!=x['expected_size']:
                raise ValueError('Source dimensions changed')
        verified.append((x,image_path))
    out.mkdir()
    entries=[]
    try:
        for spec,source in verified:
            with Image.open(source) as im:
                baseline=im.convert('RGB')
            overlay=baseline.copy()
            drawer=ImageDraw.Draw(overlay)
            points=[tuple(p) for p in spec['editable_zone']]
            drawer.line(points+[points[0]],fill=(255,200,32),width=max(3,int(baseline.width*.004)))
            # Show precise intended edit boundary; leave original untouched.
            preview=out/(spec['id']+'_ROI_GUIDE.png')
            overlay.save(preview,optimize=True)
            mask=np.where(make_mask(baseline.size,spec['editable_zone']),255,0).astype('uint8')
            mask_path=out/(spec['id']+'_EDITABLE_AREA.png')
            Image.fromarray(mask,'L').save(mask_path)
            entries.append({'id':spec['id'],'baseline':str(source),
              'baselineSha256':digest(source),'guidance':str(preview),'mask':str(mask_path),
              'canvas':list(baseline.size),'editableCoverage':round(float(np.mean(mask>0)),5),
              'preserve':spec['preserve'],'change_only':spec['change_only'],
              'rightsVerified':False,'highFidelityEditCreated':False,'productionReady':False})
        report={'schema':1,'count':len(entries),'items':entries,
         'rules':'Only inside the yellow region may be edited; the rest must match original pixels.',
         'humanVisualApproved':False,'copyrightCleared':False,'qqReady':False}
        (out/'FACE_EDIT_GUIDES_FINAL.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    except Exception:
        for file in out.glob('*'):
            if file.is_file():file.unlink()
        out.rmdir()
        raise
    return {'guidedOriginals':len(entries),'filesWritten':2*len(entries)+1,
       'editedMemeCreated':0,'qqReady':False}
def verify(*,original:Path,candidate:Path,targets_file:Path,target_id:str,out:Path)->dict:
    if out.exists():raise ValueError('Output already exists')
    spec=load_targets(targets_file)[target_id]
    if original.name!=spec['source_file']:raise ValueError('Wrong baseline for target')
    with Image.open(original) as img,Image.open(candidate) as edit:
        result=check_scope(img,edit,spec['editable_zone'])
    result.update({'source':str(original),'candidate':str(candidate),
      'sourceSha256':digest(original),'candidateSha256':digest(candidate),
      'humanVisualApproved':False,'copyrightCleared':False,
      'productionReady':False,'qqReady':False})
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return result
if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('command',choices=['prepare','verify'])
    for key in ['source-dir','index-file','targets-file','out','original','candidate','target-id']:
        ap.add_argument('--'+key)
    args=ap.parse_args()
    out=Path(args.out)
    if args.command=='prepare':
        result=prepare(source_dir=Path(args.source_dir),index_file=Path(args.index_file),
          targets_file=Path(args.targets_file),out=out)
    else:
        result=verify(original=Path(args.original),candidate=Path(args.candidate),
          targets_file=Path(args.targets_file),target_id=args.target_id,out=out)
    print(json.dumps(result,ensure_ascii=False,indent=2))
