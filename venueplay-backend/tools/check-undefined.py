import re
BUILTIN = set("""
Object Array String Number Boolean Math JSON Date RegExp Error TypeError RangeError SyntaxError
Promise Map Set WeakMap WeakSet Symbol Proxy Reflect BigInt Infinity NaN undefined
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
setTimeout setInterval clearTimeout clearInterval fetch Request Response Headers URL URLSearchParams
console crypto TextEncoder TextDecoder atob btoa structuredClone queueMicrotask AbortController
document window localStorage sessionStorage navigator location history alert confirm prompt
FormData Blob File FileReader Image Audio Intl Uint8Array Uint32Array Int32Array Float64Array
requestAnimationFrame cancelAnimationFrame getComputedStyle MutationObserver IntersectionObserver
performance globalThis self CustomEvent Event DOMParser XMLHttpRequest WebSocket
if for while switch return function typeof instanceof void delete do else try catch finally throw
class extends super async await yield break continue case default new in of let const var
""".split())

def strip(src):
    out=[]; i=0; n=len(src)
    while i<n:
        c=src[i]
        if c=="/" and i+1<n and src[i+1]=="*":
            j=src.find("*/",i+2); i = n if j<0 else j+2; out.append(" ")
        elif c=="/" and i+1<n and src[i+1]=="/":
            j=src.find("\n",i); i = n if j<0 else j; out.append(" ")
        elif c in "'\"`":
            q=c; i+=1
            while i<n and src[i]!=q:
                if src[i]=="\\": i+=1
                i+=1
            i+=1; out.append('""')
        else:
            out.append(c); i+=1
    return "".join(out)

def check(src, extra=()):
    clean = strip(src)
    defined  = set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)', clean))
    defined |= set(re.findall(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)', clean))
    defined |= set(re.findall(r'\bclass\s+([A-Za-z_$][\w$]*)', clean))
    defined |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function', clean))
    defined |= set(re.findall(r'\basync\s+([A-Za-z_$][\w$]*)\s*\(', clean))
    for params in re.findall(r'function[^(]*\(([^)]*)\)', clean):
        defined |= {p.strip().split('=')[0].strip().lstrip('.') for p in params.split(',') if p.strip()}
    for params in re.findall(r'\(([^()]*)\)\s*=>', clean):
        defined |= {p.strip().split('=')[0].strip().lstrip('.') for p in params.split(',') if p.strip()}
    defined |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=>', clean))
    defined |= set(re.findall(r'\bcatch\s*\(\s*([A-Za-z_$][\w$]*)', clean))
    defined |= BUILTIN | set(extra)
    hits={}
    for m in re.finditer(r'(?<![.\w$)\]])([A-Za-z_$][\w$]*)\s*\(', clean):
        name=m.group(1)
        if name in defined: continue
        hits.setdefault(name, clean.count("\n",0,m.start())+1)
    return sorted(hits.items(), key=lambda x:x[1])
