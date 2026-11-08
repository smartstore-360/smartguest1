import sys, json
from playwright.sync_api import sync_playwright
OUT='/tmp/claude-0/scr/rep/'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':850})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
    pg.on('dialog', lambda d: d.accept('test value 123' if 'Reason' in d.message or 'reason' in d.message else d.default_value or '10'))
    pg.goto('http://localhost:8123/')
    pg.evaluate("localStorage.setItem('sg_url','http://localhost:8123/exec')"); pg.goto('http://localhost:8123/')
    pg.fill('input[name=username]','admin'); pg.fill('input[name=password]','Secret123'); pg.click('button[type=submit]')
    pg.wait_for_selector('.stat'); pg.screenshot(path=OUT+'gas_dash.png')
    # new guest + reservation
    pg.click('a[href="#reservations"]'); pg.click('[data-act=newres]'); pg.wait_for_selector('#nr')
    pg.click('#gn'); pg.fill('#gform [name=full_name]','Ama Boateng'); pg.fill('#gform [name=phone]','0244000111'); pg.click('#gform button[type=submit]')
    pg.wait_for_selector('#gsel option')
    pg.click('#fa'); pg.wait_for_selector('[data-pick]'); pg.check('[data-pick]:first-of-type'); 
    pg.locator('[data-pick]').first.check(); pg.screenshot(path=OUT+'gas_newres.png')
    pg.click('#sv'); pg.wait_for_selector('.toast')
    print('toast1:', pg.inner_text('.toast'))
    # front desk check-in
    pg.click('a[href="#frontdesk"]'); pg.wait_for_selector('[data-act=checkin]'); pg.click('[data-act=checkin]')
    pg.fill('#ci [name=deposit_amount]','50'); pg.click('#ci button'); pg.wait_for_selector('.toast:last-child')
    pg.click('[data-act=fdtab][data-tab=inhouse]'); pg.wait_for_selector('[data-act=folio]'); pg.click('[data-act=folio]'); pg.wait_for_selector('#pf')
    pg.fill('#pf [name=amount]','25'); pg.click('#pf button'); pg.wait_for_timeout(500)
    pg.fill('#cf2 [name=description]','Minibar'); pg.fill('#cf2 [name=unit_amount]','30'); pg.click('#cf2 button'); pg.wait_for_timeout(500)
    pg.screenshot(path=OUT+'gas_folio.png')
    pg.click('[data-close]'); pg.click('[data-act=checkout]'); pg.wait_for_selector('#co'); pg.screenshot(path=OUT+'gas_checkout.png')
    print('checkout dlg:', pg.inner_text('.mbody')[:200].replace('\n',' | '))
    pg.click('[data-close]')
    for r in ['rooms','housekeeping','reports','users','settings','audit','guests']:
        pg.click(f'a[href="#{r}"]'); pg.wait_for_timeout(500); pg.screenshot(path=OUT+f'gas_{r}.png')
        assert 'err' not in (pg.inner_html('#view')[:300]).lower().split('class="card err"')[0][-1:], r
    # sign out then bad login
    pg.click('[data-act=logout]'); pg.wait_for_selector('#lf')
    pg.fill('input[name=username]','admin'); pg.fill('input[name=password]','wrong'); pg.click('button[type=submit]'); pg.wait_for_selector('#le:not(:empty)')
    print('bad login msg:', pg.inner_text('#le'))
    # mobile
    pg.set_viewport_size({'width':390,'height':800}); pg.fill('input[name=password]','Secret123'); pg.click('button[type=submit]'); pg.wait_for_timeout(2500); print('after relogin:', pg.inner_text('#app')[:80].replace(chr(10),' | ')); pg.goto('http://localhost:8123/#dashboard'); pg.wait_for_selector('.stat'); pg.screenshot(path=OUT+'gas_mobile.png')
    b.close()
print('console errors:', errs)
