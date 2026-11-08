from playwright.sync_api import sync_playwright
OUT='/tmp/claude-0/scr/rep/'; errs=[]
import urllib.request
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None); pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
    pg.on('dialog', lambda d: d.accept('reason text'))
    pg.goto('http://localhost:8123/'); pg.evaluate("localStorage.setItem('sg_url','http://localhost:8123/exec')"); pg.goto('http://localhost:8123/')
    pg.fill('input[name=username]','admin'); pg.fill('input[name=password]','Secret123'); pg.click('button[type=submit]'); pg.wait_for_selector('.stat')
    # seed sample menu through the API (editor function equivalent): create via UI
    pg.click('a[href="#restaurant"]'); pg.wait_for_selector('.tabs'); pg.click('[data-act=rtab][data-tab=setup]')
    pg.click('[data-act=newcat]'); pg.fill('#sf [name=name]','Mains'); pg.click('#sf button'); pg.wait_for_timeout(600)
    pg.click('[data-act=newtable]'); pg.fill('#sf [name=name]','Table 1'); pg.click('#sf button'); pg.wait_for_timeout(600)
    pg.click('[data-act=newmenu]'); pg.fill('#sf [name=name]','Jollof & Chicken'); pg.fill('#sf [name=price]','65'); pg.select_option('#sf [name=category_id]', index=1); pg.click('#sf button'); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT+'gas_rsetup.png')
    pg.click('[data-act=rtab][data-tab=orders]'); pg.click('[data-act=neworder]'); pg.select_option('#nof [name=table_id]', index=1); pg.click('#nof button')
    pg.wait_for_selector('#af'); pg.select_option('#af [name=menu_item_id]', index=1); pg.fill('#af [name=quantity]','2'); pg.click('#af button'); pg.wait_for_selector('[data-o="restaurant.send"]')
    pg.click('[data-o="restaurant.send"]'); pg.wait_for_selector('[data-o="restaurant.served"]'); pg.click('[data-o="restaurant.served"]'); pg.wait_for_selector('[data-o="restaurant.settle"]'); pg.screenshot(path=OUT+'gas_order.png')
    pg.click('[data-o="restaurant.settle"]'); pg.wait_for_selector('[data-print]'); pg.click('[data-print]'); pg.wait_for_selector('.sheet')
    print('sheets:', pg.locator('.sheet').count(), '| labels:', pg.locator('.copylabel').all_inner_texts(), '| footer:', pg.locator('.docfoot').first.inner_text())
    pg.pdf(path=OUT+'gas_rcpt.pdf')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')
    pg.click('a[href="#reports"]'); pg.click('[data-act=reptab][data-tab=monthly]'); pg.wait_for_selector('#mout table'); pg.screenshot(path=OUT+'gas_monthly.png')
    print('monthly has check-ins:', 'Check-ins per room' in pg.inner_text('#mout'), '| footer:', pg.locator('.docfoot').inner_text())
    b.close()
print('console errors:', errs)
