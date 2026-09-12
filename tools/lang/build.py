# -*- coding: utf-8 -*-
# Сборка словаря: python tools/lang/build.py
# Переводы лежат в dict1..dict5.py тройками (русский, українська, english).
# Русский текст в них - это и есть ключ, по которому ищет T() в приложении.
# Добавил строку в интерфейс - допиши сюда тройку и пересобери.
import io,json,importlib.util,os,sys
SP=os.path.dirname(os.path.abspath(__file__))
def load(n):
    sp=importlib.util.spec_from_file_location(n,os.path.join(SP,n+'.py'))
    m=importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m.ROWS
rows=[]
for n in ['dict1','dict2','dict3','dict4','dict5','dict6']: rows+=load(n)
seen={}
for ru,uk,en in rows:
    if ru in seen and seen[ru]!=(uk,en):
        print('РАСХОЖДЕНИЕ в переводе:', ru); sys.exit(1)
    seen[ru]=(uk,en)
def js(s): return json.dumps(s, ensure_ascii=False)
out=["/* словарь: ключ - русский исходник.",
     "   собран скриптом из scratchpad/dict*.py - править надо там, не здесь.",
     "   годится и окну, и главному процессу: первому через window, второму через require */",
     "const DICT = {"]
for lang,idx in [('uk',0),('en',1)]:
    out.append('  '+lang+': {')
    for ru in sorted(seen):
        out.append('    '+js(ru)+': '+js(seen[ru][idx])+',')
    out.append('  },')
out.append('};')
out.append('')
out.append("if (typeof window !== 'undefined') window.DICT = DICT;")
out.append("if (typeof module !== 'undefined') module.exports = DICT;")
p=os.path.join(SP,'..','..','src','lang.js')
io.open(p,'w',encoding='utf-8').write('\n'.join(out)+'\n')
print('строк в словаре:', len(seen))
