import sys,os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,ROOT+'/tools/browser-rig')
import admin_site
S=admin_site.Site(root=ROOT,fonts=True)
S.W.env(SEND_SMS_HOOK_URL='https://sms-hook.rig/',SEND_SMS_HOOK_SECRET='dGVzdC1zZWNyZXQtb25seQ==')
S.W.seed('vp_licensed_venues',[{'id':1,'name':'Kirra Beach Hotel','name_key':'kirra-beach-hotel','postcode':'4225','suburb':'Kirra','au_state':'QLD','source':'venue master list'}])
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
try:
    for w,h,m in ((320,568,True),(375,667,True),(390,844,True),(430,932,True),(1440,900,False)):
        t,s=S.open('/quick',w,h,mobile=m)
        S.until(s,'!!window.VPQuick && !!document.getElementById("qGo")',20)
        import time; time.sleep(1.5)
        print(w, S.js(s,'JSON.stringify({sh:document.documentElement.scrollHeight,ih:innerHeight,sw:document.documentElement.scrollWidth})'))
        S.shot(s,'%s/form-%d.png'%(out,w)); S.close_tab(t)
finally:
    S.close()
