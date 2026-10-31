from pathlib import Path
import ast,json,hashlib,argparse
def export(source,target):
    source=Path(source).resolve(strict=True);code=source.read_text(encoding='utf-8')
    cards=next(ast.literal_eval(n.value) for n in ast.parse(code).body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CARDS' for t in n.targets))
    body={'version':1,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'cards':cards}
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'cards':len(cards),'source_sha256':body['source_sha256']}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('target');args=p.parse_args();print(json.dumps(export(args.source,args.target)))
