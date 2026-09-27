# PLAN — Foto galerie

Sdílený stav projektu mezi **plánováním** (konverzace v claude.ai projektu „Foto galerie“) a **implementací** (Claude Code v této složce).

**Jak se soubor používá:**
- Rozhodnutí a nové úkoly vznikají při plánování a zapisují se sem.
- Claude Code pracuje podle sekce *Další kroky*. Hotové úkoly odškrtne, připíše řádek do *Logu* a nové otázky zapíše do *Otevřených otázek*.
- Po práci v Claude Code nahraj aktuální `PLAN.md` zpátky do plánovací konverzace (nebo do dokumentů projektu), aby plánování vědělo, kde se stojí.

## Předání pro Claude Code (2026-09-27)

Plánování od commitu `21ec086` přidalo rozhodnutí **D22–D26** a fáze **5, 5b, 6, 7a a 7b** (sekce *Další kroky*). Otázky Q8–Q11 jsou vyřešené, žádná další na odpověď nečeká.

**Pořadí práce:** 5 → 5b → 6 → 7a → 7b. Každou fázi dokonči včetně testů (`npm test`) a zápisu do Logu, než začneš další.

**Pravidla pro tuhle várku:**
- **Fáze 5 obsahuje nevratné kroky** (smazání `.git`, smazání repa na GitHubu). Před každým z nich zastav a nech si ho výslovně potvrdit. Předtím udělej zálohu celé složky mimo repo.
- **Od začátku fáze 5 musí mít každý commit** autora `Martin Porter` a noreply e-mail (D23). Zkontroluj `git config user.name` a `git config user.email`, než cokoli commitneš.
- **Koncepty nesmí do gitu** ani obrázky, ani texty (D24). U každé změny v publikování to ověř testem, ne jen úvahou.
- Plánování zapisuje `PLAN.md` přímo do složky. Než ho upravíš, přečti ho znovu. Kdyby vypadal nečekaně starší než poslední commit, nepřepisuj ho a porovnej s `git diff PLAN.md` (viz *Poznatky*).
- Admin a CLAUDE.md mohou potřebovat úpravy invariantů (hlavně 5 pro fázi 7b). Změny v pravidlech zapiš do `CLAUDE.md` i sem.

---

## Cíl

Jednoduchý, pěkně prezentovatelný odkaz na osobní fotky, který jde poslat kamarádům. Vzhled podle profilu na Unsplash:

1. nahoře fotka, jméno a krátký popis,
2. pod tím dva hlavní filtry, **Photos** a **Collections** (web je anglicky, D19),
3. vedle nich řádek existujících kolekcí pro rychlý klik,
4. pod tím šachovnice (masonry) fotek.

## Rozhodnutí (platí, dokud se nezmění v plánování)

| # | Rozhodnutí | Proč |
|---|---|---|
| D1 | Hosting na **GitHub Pages** z větve `main`, složka `/docs`. Bez GitHub Actions. | Zdarma, bez serveru a bez údržby |
| D2 | Adresa **`foto.martinposta.com`** (varianta B, zvolena 2026-09-26). Kód dál podporuje i podsložku (varianta A). | Portfolio běží z repa `portfolio`, ne z `martinposta.github.io` |
| D3 | Statický web, žádný backend ani přihlašování. **Správa přes lokální admin** na `localhost` s tlačítkem *Publikovat na GitHub* (git commit + push). | Upload na živé stránce by potřeboval účty a zabezpečení |
| D4 | **Originály zůstávají jen u uživatele** (JPG 5–10 MB s metadaty). Na web jde WebP do 2400 px (šířky 480/960/1600/2400, q82) a `og.jpg` 1200 px pro náhledy při sdílení. Plné rozlišení ke stažení se **nenabízí**. | Limit repa 1 GB, stačí webová kvalita |
| D5 | Z webových verzí se **odstraňují všechna metadata**. Jedinou výjimkou je autorství (D11). EXIF (fotoaparát, objektiv, expozice, datum) se před odstraněním přečte a zobrazuje se jako text pod fotkou. | Soukromí, veřejné repo, git si pamatuje všechno |
| D6 | **Kolekce se spravují v adminu** (ne podle složek). Fotka může být ve více kolekcích. | Pohodlnější než složky, jakmile existuje admin |
| D7 | Každá kolekce, skupina i fotka má **vlastní URL a vlastní náhled pro sdílení** (`/collections/<slug>/`, `/groups/<slug>/`, `/f/<id>/`). Staré adresy se přesměrují (D21). | Sdílení s přáteli je hlavní účel |
| D8 | Vzhled galerie **tichý a neutrální** (bílá, tmavý režim podle OS). Nekonkuruje fotkám. Písmo **Inter** uložené přímo ve webu (2026-09-26, viz D16). | Portfolio má výraznější styl, galerie má ukazovat fotky |
| D9 | Minimum závislostí (`sharp`, `exifr`), žádný framework, žádný build krok, žádné CDN. Písmo je uložené přímo ve webu (D16). **Jediná vědomá výjimka:** skript Cloudflare Web Analytics (D18). | Preference uživatele |
| D10 | Repo je **veřejné** (GitHub Free). Do galerie nepatří nic soukromého. | Podmínka Pages zdarma |
| D11 | Do webových kopií se cíleně zapisuje **jen `Artist` a `Copyright`** (EXIF IFD0). Nic dalšího: žádné sériové číslo, software ani nastavení vyvolání. | Kdo si fotku stáhne, vidí autora. Nic dalšího neprozradí. |
| D12 | **GPS se nikdy nepublikuje**, ani v souborech, ani v `data.json`, ani na mapě. Poloha jde na web jen přes ručně zadané pole *Místo* v přesnosti, kterou zvolí uživatel (třeba „Šumava“). Barevný profil se převádí do sRGB. | Fotka z domu nebo chalupy by prozradila adresu. Z historie gitu nejde vzít zpět. |
| D13 | Webové verze zůstávají **WebP q82** (rozhodnuto 2026-09-26 po porovnání s q90 a AVIF na vlastních fotkách). | Rozdíl je vidět jen při zvětšení, ~950 fotek do 1 GB |
| D14 | **Kolekce se řadí abecedně** (české řazení, čísla podle hodnoty) v adminu i na webu, doplněno o ★ (D15) a skupiny (D20). Ruční řazení kolekcí (↑/↓) zrušeno. | Přehlednost, nic se nemusí udržovat |
| D15 | **Zvýrazněné kolekce** (★, `collection.starred`): řadí se před ostatní, mezi sebou abecedně. Na webu mají hvězdičku a rámeček. Pro poslední výlet nebo oblíbené fotky. | Požadavek uživatele 2026-09-26 |
| D16 | **Písmo Inter**, self-hosted v `site/fonts/` (latin + latin-ext, variabilní, 134 kB, licence OFL v `site/fonts/OFL.txt`). Nahrazuje systémové písmo, aby web vypadal všude jako na Macu (San Francisco). Žádné načítání od Googlu. | Uživateli se líbí vzhled na Macu, na Windows/Androidu by byl jiný |
| D17 | **Hlavička zůstává s kulatým avatarem** (Q1), **favicon zůstává fotoaparát**. | Rozhodnuto uživatelem 2026-09-26 |
| D18 | **Statistika návštěv: Cloudflare Web Analytics** (bez cookies, doména už na Cloudflare). Token v nastavení adminu; skript se nenačte na localhost. Jediný cizí skript na webu, výjimka z D9 rozhodnutá uživatelem. | GitHub Pages sám návštěvnost neměří, Proxmox není potřeba |
| D19 | **Veřejný web je anglicky** (texty, data, `lang="en"`), adresy kolekcí `/collections/` místo `/kolekce/` (bez přesměrování, nic ještě nebylo sdílené). Admin zůstává česky. | Popisy fotek píše uživatel anglicky |
| D20 | **Skupiny kolekcí** (`collection.group`, typicky země): řazení skupina → kolekce abecedně, bez skupiny na konci; ★ zvýrazněné nahoře mimo skupiny, po odhvězdičkování zpět do skupiny. Skupina je **klikací**: stránka `/groups/<slug>/` se všemi fotkami svých kolekcí (pořadí = kolekce abecedně, každá ve svém pořadí). Přehled kolekcí má sekce Featured / skupiny / Other. | Uživatel řadí kolekce podle místa; skupina nahradí „souhrnné“ kolekce typu „Czech Rep“ |
| D21 | **Staré adresy se přesměrují**: změna adresy kolekce nebo přejmenování skupiny nechá na staré adrese přesměrovací stránku (i s náhledem pro sdílení). Přejmenování kolekce adresu nemění. Skupinu lze přejmenovat (a sloučit) kliknutím na její nadpis v adminu. | Jistota, že rozeslané odkazy nepřestanou fungovat |
| D22 | Galerie **smí být indexovaná vyhledávači** (žádný `robots.txt` zákaz). | Rozhodnuto uživatelem 2026-09-27 |
| D23 | **Commity nesmí obsahovat osobní e-mail.** Autor commitů je **Martin Porter** s anonymní adresou GitHubu `…@users.noreply.github.com`, na GitHubu je zapnuté blokování pushů s osobním e-mailem. Stará historie se jednorázově zahodí (fáze 5). | Veřejné repo, e-mail z commitů si přečte kdokoli. Jméno sjednocené s webem (Q8). |
| D24 | **Koncepty** (nahrané, ale nezveřejněné fotky) nesmí do gitu ani obrázky, ani texty, dokud je uživatel nezveřejní. Repo je veřejné a publikování dělá `git add -A`. | Koncept je soukromý polotovar. Že koncepty nejsou zálohované na GitHubu, uživatel přijal (2026-09-27). |
| D25 | **GitHub je centrální kopie a záloha.** Admin může běžet na víc strojích (Proxmox jako hlavní, Mac jako záložní). Každá instance se při startu a před publikováním **synchronizuje s GitHubem**. Sama stahuje jen bezpečně (fast-forward), konflikty nikdy neslučuje automaticky (fáze 7a). | Když server odejde, zveřejněný obsah je celý na GitHubu a na Macu. Nahradí ho klon repa. |
| D26 | **Kontaktní e-mail na webu** je alias přes **Cloudflare Email Routing** (přesměrování do osobní schránky). Adresa se skládá až v prohlížeči. Cloudflare Email Obfuscation tady nefunguje, protože `foto` je *DNS only*. | Osobní adresa se nikde neukáže, alias jde kdykoli zrušit (Q9) |
| D27 | **Řádek štítků na webu ukazuje jen ★ kolekce, skupiny a kolekce bez skupiny.** Kolekce ve skupině jsou až na stránce skupiny. Na stránce takové kolekce svítí v řádku její skupina. Myší jde řádek posouvat kolečkem, tažením i šipkami ‹ › na koncích (ukážou se jen na straně, kde jsou schované štítky; na dotykových zařízeních skryté, tam se swipuje). | S 13 kolekcemi bylo v řádku vidět jen 1–2 skupiny, zbytek schovaný (uživatel 2026-09-27) |

## Stav k 2026-09-27 (souhrn pro plánování)

**Běží živě:** https://foto.martinposta.com. Obsah: 62 fotek, 13 kolekcí v 7 skupinách (Austria, Czechia, Germany, Poland, Slovakia, Sweden, UK). Repo má 68 MB z doporučeného 1 GB. Statistika návštěv je zapnutá. Všechno je publikované, `npm test` = **30 testů**, všechny prochází.

**Veřejný web (anglicky):**
- profil (kulatý avatar, jméno *Martin Porter*, bio, odkaz na martinposta.com), záložky *Photos* a *Collections*;
- řádek štítků: ★ zvýrazněné kolekce, pak skupiny (tučný štítek skupiny, za ním její kolekce), pak kolekce bez skupiny;
- masonry mřížka 3/2/1 sloupce;
- přehled kolekcí v sekcích *Featured* / skupiny / *Other*;
- stránky kolekcí a skupin, detail fotky s vlastní URL (šipky, swipe, sdílení, **celá obrazovka F**, **skrytí popisu I**);
- Open Graph náhledy, přesměrování starých adres, písmo Inter, tmavý režim, Cloudflare Web Analytics.

**Admin (česky, jen na Macu uživatele, `Galerie.command`):**
- **nahrávání:** přetažením, se zmenšením na WebP q82 a přečtením EXIF/IPTC/XMP;
- **úpravy jedné fotky:** autosave, nahrazení upravenou verzí se zachováním URL a textů;
- **multivýběr:** název, popis, místo i datum pořízení najednou (× maže, volba *jen prázdné*), přidání do kolekce nebo nové kolekce rovnou ve skupině;
- **pořadí:** vlastní pořadí fotek pro *Vše* i každou kolekci (přetažení, Na začátek/konec, Zařadit podle data);
- **kolekce:** skupina, ★ zvýraznění, adresa, obal; přejmenování a slučování skupin z levého panelu;
- **nastavení:** profil, copyright v souborech (a jeho přepis u nahraných fotek bez ztráty kvality), token statistiky;
- **publikování:** ukazatel velikosti repa a tlačítko *Publikovat na GitHub*.

**Platforma:** Mac (Intel, Node 24, git od Applu, přihlášení ke GitHubu přes `gh`). Windows jen záložně (`Galerie.cmd`, na Windows zatím neověřeno). Doména je na Cloudflare: CNAME `foto` → `martinposta.github.io`, **DNS only**.

**Jak uživatel pracuje:** fotí Fujifilm X-T30 II, upravuje v Capture One a exportuje JPG bez vyplněných titulků. Názvy píše v adminu, anglicky, a často je nechává prázdné (místo slouží jako název). Kolekce řadí podle místa a skupiny podle země. Pseudonym **Martin Porter** (skutečné jméno Martin Pošta).

## Poznatky (co se ukázalo za běhu)

**Produkt a obsah**
- Fotka bez názvu se všude jmenuje podle **místa** (titulek, sdílení). Místo se nikde neopakuje dvakrát.
- **Skupina** (země) nahradila souhrnné kolekce typu „Czech Rep“. Stránka skupiny ukazuje fotky všech jejích kolekcí.
- Uživatel chce, aby se **všechno ukládalo samo** jako v adminu (žádné tlačítko Uložit). Mazání textu = vymazání.
- Odkazy se sdílejí, proto se URL nikdy nemají rozbít: id fotky se nemění ani při nahrazení souboru, staré adresy kolekcí a skupin se přesměrují.

**Obrázky a soukromí**
- Průměr na webu je **1,06 MB/fotka** (5 souborů: 480/960/1600/2400 WebP + `og.jpg`), takže se vejde **~950 fotek do 1 GB**. Menší verze tvoří jen ~15 % dat.
- **WebP q82** zvolena po porovnání (q90 +58 % dat, AVIF −35 %, ale vyhlazuje filmové zrno).
- Ze souborů se odstraní vše kromě `Artist` a `Copyright`. EXIF neumí diakritiku, proto „(C) Martin Porter“. Test ověřuje, že GPS a sériové číslo z originálu neprojdou.
- Autora a copyright jde **přepsat bez rekomprese** (výměna bloku EXIF), ale každé spuštění po publikování přidá do historie gitu všechny obrázky znovu. Stejně tak nahrazení a smazání fotky: historie gitu se nezmenšuje.
- Exporty z Capture One jsou sRGB. Titulky a místa se z nich načtou, pokud je v Capture One vyplníš (zatím ověřeno jen na syntetickém souboru).

**Technické pasti, které se už jednou staly**
- Mřížka porovnávala výšky s tolerancí v nesprávných jednotkách. Chyba byla od verze 1 a projevila se až po ručním přeřazení.
- Lightbox měnil `src` na stejném `<img>`, takže při swipování zůstávala vidět předchozí fotka. Teď vzniká pro každou fotku nový prvek.
- Posluchače se nesmí věšet na prvky, které přežívají překreslení (hromadily se).
- Obsah `Galerie-test/` (originály) nesmí do veřejného repa. Je v `.gitignore`, protože publikování dělá `git add -A`.
- Na Macu s Intelem Homebrew kompiluje ze zdrojáků, proto je lepší instalovat `gh` z `.pkg`.
- `PLAN.md` se 2026-09-27 dvakrát sám vrátil na starší verzi. Obě vrácené verze byly přesně ty, které dřív zapsalo plánování přes vzdálený přístup ke složce. Příčina nalezena: vzdálený zápis ze stejného pracovního souboru doručil pokaždé obsah **předchozího** zápisu (mezipaměť podle názvu). Vyřešeno zápisem přes soubor s jedinečným názvem a kontrolou součtu po zápisu. Mac, iCloud ani Claude Code v tom roli nehrály, ostatní soubory se to netýkalo. Ochrana: `PLAN.md` je v gitu, před commitem zkontrolovat `git diff PLAN.md`. Plánování po zápisu soubor znovu ověřuje.

## Další kroky

- [ ] Ověřit na jedné nově exportované fotce z Capture One s vyplněným Title / Description / Sublocation / City / Country, že se všechno načte.
- [ ] Na Windows ověřit `Galerie.cmd` a přihlášení (až to bude potřeba).
- Pořadí dalších fází: **5 → 5b → 6 → 7a → 7b**.

### Fáze 5: Anonymní e-mail v commitech a nová historie (2026-09-27)
Cíl: z veřejného repa zmizí osobní e-mail (D23). Zároveň se zahodí historie, takže ukazatel velikosti klesne na aktuální obsah. Pořadí kroků je důležité: kdyby se blokování pushů s osobním e-mailem zapnulo dřív než nová historie, GitHub by odmítal i běžné publikování (starší commity, např. `21ec086`, osobní e-mail mají).
- [x] **Uživatel na GitHubu:** Settings → Emails → opsat noreply adresu (`<číslo>+martinposta@users.noreply.github.com`). Zatím nic nezapínat.
- [x] V repu nastavit `git config user.name "Martin Porter"` a `git config user.email <noreply>` (Q8). Stačí lokálně pro toto repo, globální nastavení je volba uživatele.
- [x] Projít aktuální strom (`data/`, `docs/`, README, CLAUDE.md, PLAN.md, `tests/`), jestli v něm osobní e-mail není i jinde. Nález nahradit, ne jen zapsat.
- [x] **Záloha** celé složky včetně `.git`, kopie mimo repo. Cestu zapsat do Logu.
- [ ] **Nová historie, nevratné, před provedením výslovně potvrdit s uživatelem.** Force-push osiřelé větve nestačí: staré commity by na GitHubu zůstaly dohledatelné přes SHA. Jistá cesta je repo smazat a založit znovu:
  1. lokálně nová historie (`rm -rf .git`, `git init -b main`, `git remote add origin https://github.com/martinposta/foto.git`, jeden commit s aktuálním stavem). Obsah `21ec086` a všechny nepublikované změny se do něj dostanou samy, jde o stav souborů.
  2. **uživatel na GitHubu:** zapnout *Keep my email addresses private* a *Block command line pushes that expose my email*,
  3. **uživatel** smaže `martinposta/foto` a založí znovu prázdné veřejné repo `foto` (bez README),
  4. `git push -u origin main`. Přihlášení přes `gh` zůstává, nic se nemění.
  5. Settings → Pages: `main` + `/docs`, custom domain `foto.martinposta.com` (soubor `docs/CNAME` už existuje), po vydání certifikátu *Enforce HTTPS*. Počítat s krátkým výpadkem (minuty až hodina), Cloudflare DNS i statistika se nemění.
- [ ] Ověřit: `git log --format='%an <%ae>' | sort -u` ukazuje jen `Martin Porter <…noreply…>`, web běží na doméně s HTTPS, fungují OG náhledy, přesměrování (D21) i statistika, ukazatel velikosti ukazuje nový stav (očekávaně kolem 70 MB).
- Poznámka: SHA commitů v Logu (např. `fac6c78`, `f3daa45`, `21ec086`) po resetu přestanou existovat. Nechat je v Logu jako historický záznam.

### Fáze 5b: Kontaktní e-mail přes alias (D26, Q12)

**Výchozí stav (ověřeno 2026-09-27):** DNS domény je na Cloudflare (`ishaan`/`rosalie.ns.cloudflare.com`). Jediný poštovní záznam je `MX 1 mxredir.wedos.net`, tedy přesměrování pošty u Wedosu. Doména nemá SPF ani DMARC. Portfolio ukazuje osobní Gmail (skládá ho v prohlížeči, `assets/include.js`), žádnou adresu `@martinposta.com`. Registrace domény zůstává u Wedosu, přes Cloudflare jde jen DNS a pošta.

**Jak funguje Email Routing:** Cloudflare poštu jen **přijímá a přeposílá**. Zpráva na `foto@martinposta.com` přijde do Gmailu. Když z Gmailu odpovíš, odesílatel uvidí **Gmail adresu**, protože Cloudflare poštu neodesílá. Odpovídat jako `foto@…` jde přes Gmail *Poslat jako* (viz níže, nepovinné).

**Návod (uživatel, v Cloudflare):**
- [ ] **0. Co přestane fungovat:** přesměrování nastavená ve Wedosu (pokud nějaká jsou, třeba `info@`) po přepnutí MX přestanou platit. Portfolio žádnou takovou adresu neukazuje. Kdo si není jistý, přihlásí se do Wedosu jednou naposledy a opíše si seznam přesměrování, jinak se ztráta akceptuje.
- [ ] **1.** Cloudflare → doména `martinposta.com` → **Email → Email Routing → Get started / Enable**.
- [ ] **2. Destination address:** zadat osobní Gmail. Cloudflare na něj pošle ověřovací e-mail, potvrdit odkaz.
- [ ] **3. Custom address:** `foto` → *Send to an email* → ověřený Gmail. (Stejně jde přidat cokoli dalšího, např. `info`, nebo *Catch-all*, která pošle do Gmailu vše na doménu. Catch-all nedoporučeno, chodí na ni spam.)
- [ ] **4. DNS záznamy:** Cloudflare nabídne *Add records and enable*. Přidá 3× MX `route1–3.mx.cloudflare.net` a TXT SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`. Starý MX `mxredir.wedos.net` označí jako konfliktní a nabídne jeho smazání, **potvrdit**. (Kdyby ho nenabídl, smazat ručně v DNS.)
- [ ] **5. Test:** z jiné adresy než Gmail (Gmail sám sobě někdy přeposlanou zprávu nezobrazí) poslat e-mail na `foto@martinposta.com`, zkontrolovat Doručenou poštu i Spam. Stav a zprávy jsou vidět v Email Routing → *Activity log*. Změna MX se může šířit až několik hodin, do té doby mohou zprávy chodit ještě přes Wedos.
- [ ] **6. Doporučeno:** DMARC záznam `TXT _dmarc  v=DMARC1; p=none; rua=mailto:<Gmail>` (jen hlášení, nic neblokuje). Chrání doménu před tím, aby ji někdo zneužíval jako odesílatele.
- [ ] **7. Nepovinné, odpovídat jako foto@:** Gmail → Nastavení → *Účty a import* → *Odesílat poštu jako* → přidat `foto@martinposta.com`, SMTP `smtp.gmail.com`, port 587, přihlášení Gmailem a **heslem aplikace** (Google účet → Zabezpečení → Hesla aplikací, vyžaduje dvoufázové ověření). Potvrzovací kód přijde přes Email Routing. Do SPF pak přidat Google: `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all`. Příjemce pak vidí `foto@…`, i když v podrobnostech zprávy bude znát, že šla přes Gmail.

**Claude Code:**
- [ ] Nastavení *Kontaktní e-mail* v adminu (česky). Na webu se zobrazí u odkazů v profilu anglicky (*Email*). Celá adresa nesmí být jako text v HTML, `data.json` ani v `data/gallery.json` (ten je taky veřejný v repu): uloží se rozdělená (jméno a doména zvlášť) a `mailto:` se složí v prohlížeči, stejně jako na portfoliu.
- [ ] Test: žádný soubor v `docs/` ani `data/` neobsahuje celou adresu, v prohlížeči se odkaz složí správně.

### Fáze 6: Koncepty, skryté fotky (2026-09-27)
Scénář: nahrát a popsat celý výlet v klidu a zveřejnit ho najednou. Publikování mezitím nesmí nic z konceptů poslat ven (D24).
- [ ] Stav fotky `draft`. Koncepty se ukládají **mimo git**: obrázky do `drafts/img/<id>/`, záznamy do `data/drafts.json`, obojí v `.gitignore`. **Zveřejnit** přesune záznam do `data/gallery.json` a obrázky do `docs/img/`.
- [ ] Nové fotky se **vždy nahrávají jako koncept** (Q11). V horní liště adminu výrazné tlačítko **Potvrdit nové fotky (N)**, které zveřejní všechny koncepty najednou. Po potvrzení se změny odešlou až tlačítkem *Publikovat*, případně nabídnout obojí jedním krokem.
- [ ] Admin: štítek *koncept* na náhledu, položka *Koncepty* v levém panelu s počtem, tlačítko **Zveřejnit** v editoru i v multivýběru, v multivýběru i *Vrátit do konceptů*. U vrácení upozornit, že už zveřejněná verze zůstane v historii gitu.
- [ ] Koncepty fungují jako ostatní fotky: úpravy textů, kolekce, pořadí, nahrazení souboru, přepis autora, detekce duplicit přes `sourceHash`. Na webu se nikde neobjeví: `data.json`, stránky, počty, obaly kolekcí, OG, přesměrování. Kolekce jen s koncepty se na webu neukáže.
- [ ] Náhled webu v adminu ukazuje stav jako online. Volitelně přepínač *Náhled včetně konceptů*.
- [ ] Testy: po nahrání konceptu a publikování neobsahuje `git ls-files` ani `git show HEAD:data/gallery.json` nic z konceptu, v `docs/` není žádný soubor konceptu, po zveřejnění ano. Smazání konceptu nezanechá stopu v gitu.
- [ ] Návaznost na existující funkce:
  - **Vlastní pořadí** (fáze 4): koncepty v adminu vidět jsou, ale do `settings.order` ani `collection.order` se dostanou až při zveřejnění. Podle Q7 na začátek seznamu, u automatického řazení podle data.
  - **Skupiny a kolekce**: počty na webu jen ze zveřejněných fotek, v adminu zvlášť *(N konceptů)*.
  - **Nahrazení souboru** (2b): koncept zůstane konceptem a jeho soubory zůstanou v `drafts/`.
  - **Přepis autora** (2d): musí zahrnout i soubory v `drafts/img/`.
  - **Ukazatel velikosti** (2e): koncepty nepočítat, do repa zatím nepatří. Volitelně zobrazit zvlášť *koncepty X MB*.
  - **Smazání konceptu**: jen smazat soubory, git se ho netýká.
- [ ] Migrace: stávajících 62 fotek zůstává zveřejněných, nic se nepřesouvá.
- Poznámka: koncepty nejsou zálohované na GitHubu (uživatel to přijal, D24). Na Macu je jistí Time Machine, po fázi 7b zálohy Proxmoxu.

### Fáze 7a: Synchronizace s GitHubem (D25, nápad uživatele 2026-09-27)
Cíl: libovolná instance adminu (Proxmox, Mac) je rychle aktuální kopie. Když server odejde, stačí spustit admin na Macu a je všechno zpátky. Užitečné i dřív, než admin přejde na Proxmox.
- [ ] **Při startu adminu:** `git fetch`. Když je lokální kopie pozadu a nemá nepublikované změny, stáhne se automaticky (`git merge --ff-only`) a web se přestaví. Když pozadu je a zároveň má nepublikované změny, admin nic nestahuje a ukáže varování s návodem.
- [ ] **Průběžně** (např. každých 5 min a při návratu do okna) `git fetch` a v liště pruh *Na GitHubu jsou novější změny* s tlačítkem **Synchronizovat**.
- [ ] **Před publikováním:** `git fetch`. Když je GitHub napřed: `git pull --rebase`. Při konfliktu (typicky `data/gallery.json`) rebase zrušit, nic neposílat a srozumitelně vysvětlit, co dál. Nikdy nepoužít force-push.
- [ ] Stav synchronizace v liště vedle ukazatele velikosti: *aktuální / pozadu o N / nepublikované změny*.
- [ ] **Koncepty se nesynchronizují**, jsou mimo git (D24). Každá instance má vlastní. Admin to má říct u tlačítka Synchronizovat. Zálohu konceptů na hlavní instanci řeší zálohy Proxmoxu. Kdyby bylo potřeba víc, zvážit později soukromé repo jen na koncepty.
- [ ] Testy s dvěma klony proti jednomu bare repu: automatický fast-forward při startu, varování při rozdělené historii, pull --rebase před publikováním, zrušení rebase při konfliktu.
- Doporučený návyk: publikovat často. Co je publikované, je na GitHubu a v každé další kopii.

### Fáze 7b: Admin na Proxmoxu (Q10: ano, hlavní instance)
Motivace: víc počítačů a zařízení v domácnosti, uživatel přesouvá aplikace do homelabu. Mac zůstává jako záložní instance (7a) a pro vývoj (Claude Code, `npm test`).
- **Nasazení:** Docker kontejner (jako generátor faktur) nebo LXC s Node 22 a gitem. Klon repa na trvalém svazku (`data/`, `docs/`, `drafts/`, `.git`). Zahrnout do záloh Proxmoxu, jsou v něm i koncepty.
- **Přístup jen přes Tailscale**, žádný Cloudflare tunel ven: admin nemá přihlašování. Kód musí umět nastavit adresu naslouchání a povolené hosty (dnes natvrdo `127.0.0.1` a `localhost`, invariant 5), např. `ADMIN_HOST` a `ADMIN_ALLOWED_HOSTS`. Volitelně k tomu jednoduché heslo (basic auth), rozhodne uživatel při nasazení.
- **Push na GitHub ze serveru:** *deploy key* (SSH klíč s právem zápisu jen do repa `foto`), ne token k celému účtu. Autor commitů je Martin Porter s noreply adresou (D23).
- **Kód vs. obsah:** kód se vyvíjí na Macu a jde přes GitHub, server commituje hlavně obsah. Díky 7a se server k novému kódu dostane synchronizací. Po stažení nového kódu je potřeba `npm ci`, restart a přestavění webu (`docs/assets/` generuje build). Chce to tlačítko nebo příkaz *Aktualizovat aplikaci*.
- **Nahrávání z telefonu** přes Tailscale by znovu otevřelo HEIC (backlog). Převod na serveru neumí `sips`, musel by jít přes jiný nástroj. Zatím není požadované.
- Pořadí: až po fázích 5, 6 a 7a. Server si naklonuje už čisté repo.

## Hotové fáze (archiv s podrobnostmi)

### Fáze 1: Zprovoznění u uživatele (macOS)
- [x] Node.js a git nainstalované (Node 24.20, git 2.39 od Applu, `user.name`/`user.email` nastavené)
- [x] Projekt ve složce, `npm install` hotový
- [x] `npm test` projde na Macu
- [x] `Galerie.command` (spustitelný, LF) spouští admin; první spuštění dvojklikem přes pravý klik → Otevřít (Gatekeeper)
- [x] **Přihlášení ke GitHubu na Macu:** vyřešeno přes GitHub CLI (`gh auth login` + `gh auth setup-git`, HTTPS, token v Klíčence), uživatel ho nainstaloval sám. SSH tedy není potřeba.
- [x] Veřejné repo `martinposta/foto`, `origin` = `https://github.com/martinposta/foto.git`
- [x] První publikování z adminu prošlo (upstream nastaven)
- [x] GitHub → Settings → Pages: `main` + `/docs`, běží na https://martinposta.github.io/foto/
- [x] Doména: varianta B, **https://foto.martinposta.com/** (Cloudflare CNAME DNS only, certifikát Let's Encrypt, Enforce HTTPS zapnuté)
- [x] README: postup pro macOS (Terminál, `Galerie.command`, `gh`), Windows jako druhá varianta

### Fáze 1b: Autorství v souborech (udělat PŘED nahráním skutečných fotek)
Kopie na webu se generují jen při nahrání. Fotky nahrané dřív by copyright neměly, dodatečné přepsání by znamenalo ztrátovou rekompresi.
- [x] Nastavení `settings.copyright` (text, výchozí `© Martin Pošta`). V adminu v *Profil a nastavení* pole „Copyright v souborech“ s nápovědou. Prázdné pole = nezapisovat nic.
- [x] `processImage()` zapíše do všech webových kopií (WebP i `og.jpg`) jen `IFD0.Artist` (= `settings.name`) a `IFD0.Copyright` přes `sharp().withExif()`. Nesmí se použít `keepExif()` ani `withMetadata()`, ty by přenesly GPS a zbytek EXIFu z originálu.
- [x] Upravit test *metadata is stripped*. Výstup obsahuje `Artist` a `Copyright`, **neobsahuje** GPS, `Make`, `Model`, `BodySerialNumber`, `Software` ani XMP. Testovací fotka musí mít GPS a sériové číslo, aby se to opravdu ověřilo.
- [x] Aktualizovat invariant 2 v `CLAUDE.md`, pokud se implementace liší od popisu.
- Zjištění: EXIF text je jen ASCII, libvips proto zapíše „Martin Posta“ a „(C) Martin Posta“. Viz Q6.

### Fáze 2: Test na skutečných fotkách
- [x] Změřeno na 67 skutečných fotkách (Capture One export, Fujifilm X-T30 II + 1× iPhone, 4–35 MB, celkem 1 GB): **web 72,5 MB, průměr 1,06 MB/fotka → cca 950 fotek do 1 GB**. Rozpad: 2400 px 19 MB, 1600 px 20 MB, 960 px 9 MB, 480 px 2 MB, og.jpg 9 MB. Zpracování ~3 s/fotka. Téměř duplicitní šířky (1600 vedle 1619) se už negenerují, úspora ~5 %.
- [x] Zkontrolovat kvalitu WebP q82 na detailech (listí, noční nebe, gradienty). Porovnání 9 fotek připravené v `Galerie-test/_porovnani/index.html` (mimo git). Na 9 fotkách: q82 4,7 MB, **q90 +58 %**, **AVIF q60 −35 %**. Zjištění: rozdíly jsou vidět jen při zvětšení, q82 i AVIF vyhlazují filmové zrno (vysoké ISO, kůže), q90 ho drží. **Rozhodnuto: zůstává q82 (D13).**
- [x] Nástroj uživatele: **Capture One** (22/23). Testovací exporty nemají vyplněný titulek, popis, klíčová slova ani místo (jen EXIF + copyright), takže import je teď prázdný. Z EXIF se čte fotoaparát, objektiv, expozice a datum u všech 67. Doplněno čtení *Sublocation* (`Iptc4xmpCore:Location`) do pole Místo a oprava fotoaparátu u fotky, která prošla Adobe (Make „Adobe Systems Inc.“, Model „Tiff File“ → „iPhone 11“ z názvu objektivu). Oba případy mají test.
- [ ] Ověřit na jedné nově exportované fotce z Capture One s vyplněným Title/Description/místem, že se vše načte (zatím ověřeno jen na syntetickém XMP).
- [x] Barvy: 53 exportů má ICC sRGB, 14 nemá profil, ale EXIF ColorSpace = sRGB. Adobe RGB / P3 se v exportech nevyskytuje, převod není potřeba řešit. GPS (iPhone fotka) na webové verze neprojde, ověřeno.
- [x] Otestovat sdílení odkazu v Messengeru a WhatsAppu (náhled obrázku, titulek). Ověřeno uživatelem 2026-09-26, dopadlo dobře.

### Fáze 2b: Nahrazení fotky novou verzí (požadavek uživatele 2026-09-26)
Scénář: fotka je v galerii, uživatel ji v Capture One znovu upraví (barvy, ořez) a chce nahrát novou verzi **místo** původní.
- [x] V editoru fotky tlačítko **Nahradit soubor…** (výběr souboru nebo přetažení na náhled v editoru).
- [x] **Zachovat id a URL** `f/<id>/`: odkazy už mohly být rozeslané. Id tedy přestává být vždy hash obsahu; u fotky se uloží `sourceHash` (hash aktuálního souboru) a detekce duplicit porovnává s ním, aby opětovné nahrání nové verze bylo pořád rozpoznané jako duplicita.
- [x] Zachovat vše, co uživatel vyplnil (název, popis, místo, kolekce, obal kolekce, náhled webu). Z nového souboru převzít rozměry, šířky, barvu, velikost a EXIF. Prázdná pole (název, popis, místo, datum, klíčová slova) se doplní z metadat nového souboru, vyplněná se nepřepisují. *(Změna proti návrhu: rozlišit „datum ručně změněné“ by znamenalo nové pole; znovu vyexportovaná fotka má stejné datum pořízení.)*
- [x] Obrázky mají stejná jména souborů, takže je potřeba **cache-busting**: u fotky `version` (zvýší se při nahrazení) a URL obrázků dostanou `?v=<version>`, jinak prohlížeče a CDN GitHub Pages chvíli ukazují starou verzi. Totéž pro `og.jpg` v OG tagu (Messenger si náhledy cachuje sám, to neovlivníme).
- [x] Staré odvozené soubory smazat, protože nová verze může mít jiné šířky (jiný ořez).
- [x] Test: nahrazení zachová id, texty a kolekce, změní rozměry a `version`, staré šířky zmizí, nová verze nahraná znovu je duplicita.
- Poznámka pro uživatele: stará verze zůstane v historii gitu, takže každé nahrazení zvětší repo asi o 1 MB.
- Hotovo 2026-09-26: `POST /api/photos/:id/replace`, `replacePhoto()` v `lib/gallery.mjs`, tlačítko + přetažení na náhled v editoru, `?v=` v URL obrázků na webu, v OG tazích i v adminu. Nové soubory se generují do `<id>.new` a přesunou až po úspěchu. Ověřeno i ručně v adminu nad dočasnými daty.

### Fáze 2c: Hromadné vyplnění textů (požadavek uživatele 2026-09-26)
Exporty z Capture One nemají název, popis ani místo, takže je uživatel dopisuje v adminu.
- [x] V panelu pro více vybraných fotek pole **Název, Popis, Místo**. Když mají všechny vybrané stejnou hodnotu, je předvyplněná, jinak pole ukazuje „různé hodnoty“.
- [x] **Ukládá se jako všude v adminu, bez tlačítka Uložit** (sjednoceno na přání uživatele): po opuštění pole nebo Enteru. Ne při každém stisku klávesy jako v editoru jedné fotky, protože s volbou *jen prázdné* by uložení „Šu“ fotky vyplnilo a dopsané „Šumava“ by je pak přeskočilo. Vyprázdněné pole = vymazat u všech; **×** vymaže okamžitě (jediná cesta, když hodnoty byly různé a pole začíná prázdné).
- [x] Volba **Jen u fotek, kde je pole prázdné** (nepřepíše už vyplněné).
- [x] API: `POST /api/photos/bulk` s `{ ids, set: { title, description, location }, clear: [...], onlyEmpty }`. Whitelist jen těchto tří polí, `clear` má přednost, vrací upravené fotky. Test.
- Po uložení se panel nepřekresluje, aby nepřišel o fokus pole, kam uživatel právě klikl.

### Fáze 2d: Drobnosti z prvního nahrání (2026-09-26)
- [x] **Fotka bez názvu se jmenuje podle místa**: titulek stránky, `og:title` při sdílení, název záložky a Web Share. Uživatel název často nevyplní, protože by opakoval místo. Záložní popis pak místo neopakuje. Na stránce samotné se místo už dřív ukazovalo jen jednou. Test.
- [x] **Pseudonym:** skutečné jméno Martin Pošta, umělecké *Martin Porter*. Rozhodnutí uživatele: jméno i copyright „Martin Porter“ (v souborech „(C) Martin Porter“).
- [x] **Přepis autora a copyrightu u už nahraných fotek bez rekomprese** (`POST /api/photos/rewrite-author`, tlačítko v nastavení s potvrzením): vymění se jen EXIF blok (WebP chunk `EXIF` + příznak ve `VP8X`, JPEG APP1), obrazová data zůstanou bajtově stejná. Prázdný copyright EXIF odstraní. Test ověřuje shodu pixelů, zakázané tagy i opakované spuštění. Spuštěno na 14 fotkách uživatele (62 souborů, pixely 62/62 shodné, všechny se dekódují v prohlížeči). Pozor: každé spuštění po publikování přidá do historie gitu všechny obrázky znovu.

### Fáze 2e: Ukazatel velikosti repa (2026-09-26)
- [x] V horní liště adminu „X MB z 1 GB“: `git count-objects` (celá historie) + velikost nepublikovaných souborů v `docs/img/`. Od 70 % oranžová, od 90 % červená, tooltip s rozpisem. Test (nepublikované → po publikování v historii).
- Stav po prvním publikování: **20 MB** (14 fotek).
- **Když se bude limit blížit** (dohoda s uživatelem): přesunout obrázky mimo GitHub (Cloudflare R2 10 GB zdarma, nebo vlastní server/Proxmox) a web nechat na Pages, případně čisté repo bez historie. Popsáno v README → Limity a údržba.

### Fáze 3: Vizuální doladění (po rozhodnutí v plánování)
- [x] Hlavička: zůstává kulatý avatar (D17).
- [x] Typografie: písmo Inter self-hosted (D16).
- [x] Odkaz zpět na portfolio v hlavičce nebo navigaci. (Už je: odkaz martinposta.com v profilu, z nastavení *Odkazy*.)
- [x] Favicon a náhled pro sdílení celé galerie. (Favicon zůstává fotoaparát, D17. Náhled galerie = *náhledová fotka webu* z adminu, jinak první fotka.)
- [x] **Režim celé obrazovky v prohlížeči fotky** (hotovo 2026-09-26: ⛶/F, ⓘ/I s pamětí v `localStorage`, ovládání mizí po 2,5 s nečinnosti, Esc nejdřív ukončí celou obrazovku, na iPhonu náhrada uvnitř stránky; varianta „popis vedle fotky“ zůstává otevřená pro plánování) (požadavek uživatele 2026-09-26). Na laptopu s taby a lištou záložek zabere popis, řádek detailů a kolekce pod fotkou tolik místa, že na fotku ho zbývá málo. Návrh:
  - tlačítko ⛶ v horní liště lightboxu a klávesa **F**: Fullscreen API, jen fotka na černém pozadí, šipky, swipe a Esc fungují dál;
  - klávesa **I** / tlačítko ⓘ schová nebo ukáže panel s popisem a detaily i bez celé obrazovky, nastavení si prohlížeč pamatuje (`localStorage`);
  - iPhone Safari Fullscreen API pro obrázky nepodporuje, tam tlačítko jen schová panel a lištu (fotka přes celý displej);
  - případně zvážit rozložení, kde je na širokých obrazovkách popis vedle fotky místo pod ní (fotka pak dostane celou výšku). Rozhodnout v plánování spolu s Q1/Q2.

### Fáze 4: Vlastní pořadí fotek (HOTOVO 2026-09-26)
Požadavek uživatele 2026-09-26: řadit si fotky ručně. Třeba dát jednu fotku v kolekci na začátek nebo na konec, nebo posunout skupinu dohledaných starých fotek (např. z roku 2022) dozadu. Dnes existuje jen globální řazení (datum pořízení / nahrání) a kolekce je jen jeho výřez.

**Model:** automatické řazení zůstává jako výchozí stav. Ruční pořadí je jeho **rozšíření**.
- Hlavní stránka (*Vše*) a **každá kolekce mají vlastní pořadí**. Pořadí v kolekci neovlivní *Vše* a naopak.
- Každý seznam je buď **automatický** (podle data pořízení nebo nahrání, jako dnes), nebo **vlastní**. Ruční pořadí vznikne při prvním přesunutí jako kopie aktuálního automatického pořadí, takže se nic nepřeskládá.
- Uložení: `settings.order` (pole id pro *Vše*) a `collection.order` (pole id pro kolekci). `null` = automatické. Tlačítko *Vrátit na řazení podle data* pole smaže.
- Nově nahrané fotky se do vlastního pořadí zařadí **na začátek** (varianta: podle data, viz Q7).

**Nástroje v adminu** (jen pro zobrazený seznam, tj. *Vše* nebo vybraná kolekce):
- **Přetažení** náhledu (i více vybraných najednou) mezi ostatní.
- Pro vybrané fotky: **Na začátek**, **Na konec** a **Zařadit podle data**. Poslední možnost je řešení pro dohledané staré fotky: vybrané se přesunou tam, kam patří podle data pořízení, a zbytek vlastního pořadí zůstane beze změny.
- Kolekce samotné se řadí abecedně (D14), ruční řazení kolekcí bylo odstraněno.

**Web:** `data.json` ponese pořadí *Vše* (pořadí pole `photos`) a u každé kolekce seznam id ve správném pořadí. `app.js` tedy kolekci přestane jen filtrovat z hlavního pořadí. Obal kolekce: pokud není nastavená ★, použije se první fotka vlastního pořadí.

**Test:** přesun na začátek/konec, zařazení podle data, nezávislost kolekce a *Vše*, nová fotka ve vlastním pořadí, návrat na automatické, smazaná fotka zmizí z pořadí, `data.json` a stránky kolekcí mají správné pořadí.
- [x] Hotovo: `lib/order.mjs` (`orderedPhotos`, `reorder` s akcemi move/start/end/bydate), `POST /api/order {list, action, ids, before}` včetně `reset`, `settings.order` + `collection.order`, pročištění po smazání a odebrání z kolekce, `data.json` s pořadím kolekcí (`collections[].photos`), `app.js` bere pořadí kolekce z něj. Admin: stav řazení pod nadpisem s odkazem *vrátit podle data*, přetahování v mřížce se značkou místa, tlačítka Na začátek / Na konec / Zařadit podle data v editoru fotky i v multivýběru (jen ve Všech fotkách a v kolekci, ne v „Bez kolekce“). Testy: logika (lib) i celé API až po `data.json`. Ověřeno v UI nad dočasnými daty.

## Backlog (neřazeno, čeká na rozhodnutí)
- [→] Skryté fotky / koncept → fáze 6
- [x] Hromadná úprava data pořízení u vybraných fotek (hotovo 2026-09-27: pole v multivýběru, rozpětí dat v nápovědě, × maže, validace tvaru)
- [x] Anglická verze webu → celý veřejný web anglicky, bez přepínače (D19, hotovo 2026-09-27)
- [x] Statistika návštěv: Cloudflare Web Analytics (D18). Token vložen uživatelem, běží.
- [ ] Podpora HEIC (iPhone). Prebuilt sharp HEVC neumí. Na Macu by šlo převádět vestavěným `sips`. Pro uživatele teď nepotřebné (exportuje JPG z Capture One).
- [ ] Ruční pořadí fotek na stránce skupiny (teď se skládá z pořadí jejích kolekcí).
- [ ] Rozložení detailu fotky s popisem vedle fotky na širokých obrazovkách (alternativa k F/I).
- ~~Mapa míst~~ (vyřazeno uživatelem 2026-09-27).

## Otevřené otázky pro plánování

- **Q12 (vyřešeno 2026-09-27):** Pošta domény se přesouvá z Wedosu na **Cloudflare Email Routing** (uživatel přenáší vše kolem domény na Cloudflare a do Wedosu se nepřihlašuje). Návod je ve fázi 5b.
- **Q13 (vyřešeno 2026-09-27):** Ano, kolekce, která má jen koncepty, je sama koncept a leží v `data/drafts.json`, dokud se nezveřejní její první fotka. Totéž platí pro skupinu, popis kolekce, ★ a obal, pokud by jinak prozradily koncept.
- **Q14 (vyřešeno 2026-09-27):** Koncepty v mřížce adminu nahoře se štítkem *koncept*. Tlačítka *Potvrdit* a **Potvrdit a publikovat**.
- **Q15 (vyřešeno 2026-09-27):** Při synchronizaci se konflikty v generovaném `docs/` řeší přestavěním webu z výsledných dat. Zastavit se jen na konfliktu v `data/`.
- **Q8 (vyřešeno 2026-09-27):** Autor commitů je „Martin Porter“ (D23).
- **Q9 (vyřešeno 2026-09-27):** Kontaktní e-mail na webu přes alias Cloudflare Email Routing, adresa se skládá v prohlížeči (D26, fáze 5b).
- **Q10 (vyřešeno 2026-09-27):** Admin poběží hlavně na Proxmoxu. Uživatel chce redundanci, proto nápad s pull při startu: GitHub jako centrální kopie a každá instance se synchronizuje (D25, fáze 7a). Docker, nebo LXC a heslo navíc se rozhodne při nasazení (7b). Nahrávání z telefonu zatím ne.
- **Q11 (vyřešeno 2026-09-27):** Nové fotky jsou vždy koncept. Zveřejní je tlačítko *Potvrdit nové fotky* (fáze 6).

- **Q1 (vyřešeno 2026-09-26):** Kulatý avatar zůstává (D17).
- **Q2 (vyřešeno 2026-09-26):** Uživateli se líbí současné písmo; bylo to systémové (na Macu San Francisco), proto nahrazeno podobným Interem uloženým ve webu, aby vypadalo všude stejně (D16).
- **Q3 (vyřešeno 2026-09-26):** Varianta **B**, `foto.martinposta.com`. Portfolio je repo `martinposta/portfolio` s vlastní doménou `martinposta.com` (ne user site `martinposta.github.io`), takže varianta A by vyžadovala přejmenování repa portfolia. Cloudflare CNAME `foto` → `martinposta.github.io` musí zůstat *DNS only*.
- **Q5 (vyřešeno 2026-09-26):** Kvalita webových verzí → **WebP q82** (D13). Podklad zůstává v `Galerie-test/_porovnani/` (výřezy i celé fotky s přepínačem).
- **Q6 (vyřešeno 2026-09-26):** Zůstává jen EXIF bez diakritiky („Martin Posta“, „(C)“), XMP se nepřidává. Původní otázka: Diakritika v autorství: EXIF `Artist`/`Copyright` neumí háčky, v souborech je „Martin Posta“ a „(C)“. Stačí to? Alternativa: přidat k tomu **jen** XMP `dc:creator` + `dc:rights` (UTF-8, „Martin Pošta“, „©“), které Lightroom, Photoshop i macOS čtou přednostně. Znamenalo by to upravit D5/D11 (XMP jen s těmito dvěma poli). Malá změna, ~0,5 kB na soubor.
- **Q7 (vyřešeno 2026-09-26):** (a) Ano: automaticky podle data, dokud uživatel ručně nepřeskládá, potom si seznam drží vlastní pořadí; samostatně pro *Vše* a pro každou kolekci. (b) Nové fotky ve vlastním pořadí: na začátek (návrh, uživatel nerozporoval). (c) Až po nahrání fotek.
- **Q4 (vyřešeno):** Uživatel si v nastavení zvolil řazení podle data pořízení. Navíc může každý seznam přeřadit ručně (fáze 4).

## Log

Formát: `YYYY-MM-DD — kdo — co`

- 2026-09-26 — plánování — Rozhodnutí D1–D10, výběr lokálního adminu místo veřejného uploadu.
- 2026-09-26 — Claude (cloud) — Verze 1 hotová a otestovaná v Linuxu (admin, web, publish do lokálního bare repa, 12 testů). Oprava: `GIT_TERMINAL_PROMPT=0` odstraněn, blokoval by přihlašovací okno GCM na Windows. Předáno Claude Code.
- 2026-09-26 — plánování — Soukromí: metadata se z webových kopií dál mažou (D5), GPS nikdy (D12), do souborů se zapisuje jen autor a copyright (D11). Nový úkol, fáze 1b.
- 2026-09-26 — plánování — Uživatel pracuje na Macu (ve složce už je `Galerie.command`, `.gitattributes` pro LF/CRLF, `npm install` pro darwin-x64). CLAUDE.md a fáze 1 v PLAN.md převedené na macOS. Přihlášení ke GitHubu na Macu je otevřený bod (doporučen SSH klíč).
- 2026-09-26 — Claude Code (Mac) — `gh` přihlášený jako `martinposta`, repo `martinposta/foto` (veřejné, prázdné) jako `origin`. `gh auth login` nenastavil git credential helper, doplněno `gh auth setup-git` (ověřeno `git credential fill`). README o tom teď ví.
- 2026-09-26 — Claude Code (Mac) — Fáze 1 hotová: první publikování prošlo, Pages běží na https://martinposta.github.io/foto/ (ověřeno: `/`, `/kolekce/`, `data.json`, assety 200, neznámá cesta 404). Zjištěno nastavení portfolia pro Q3, doporučena varianta B.
- 2026-09-26 — Claude Code (Mac) — Doména `foto.martinposta.com` živá: DNS → GitHub Pages, certifikát Let's Encrypt (do 25. 12. 2026, obnovuje GitHub), HTTP i `martinposta.github.io/foto/` přesměrovávají 301 na HTTPS doménu, OG tagy mají absolutní URL, portfolio `martinposta.com` nedotčené. Fáze 1 kompletní.
- 2026-09-26 — Claude Code (Mac) — Fáze 2, test na 67 skutečných fotkách: měření velikosti, porovnání kvality (Q5), kontrola barev a GPS. `lib/images.mjs`: Sublocation do Místa, fotoaparát u souborů přeuložených přes Adobe, bez téměř duplicitních šířek. `npm test` 14/14. `Galerie-test/` přidáno do `.gitignore` (originály nesmí do veřejného repa).
- 2026-09-26 — uživatel — Q5: zůstává WebP q82 (D13). Nový požadavek: nahrazení fotky upravenou verzí se zachováním URL a popisků → Fáze 2b.
- 2026-09-26 — Claude Code (Mac) — Srovnán PLAN po nahrání z plánování: fáze 1 znovu odškrtnutá podle skutečnosti (přihlášení přes `gh`, ne SSH), rozhodnutí o kvalitě přečíslováno na **D13** (D11 je autorství z plánování), fáze 2b přesunuta za fázi 2.
- 2026-09-26 — Claude Code (Mac) — Fáze 1b hotová: `settings.copyright` (výchozí „© Martin Pošta“, pole v *Profil a nastavení*), `processImage()` zapisuje do všech šířek i `og.jpg` jen `Artist` + `Copyright` přes `withExif()`. Test se zdrojem s GPS, sériovým číslem, Software a cizím Artistem; ověřeno i opačně (s `keepExif()` test spadne). Prázdný copyright = soubory bez EXIF (test). `npm test` 15/15. Otevřena Q6 (diakritika).
- 2026-09-26 — uživatel — Q6: autorství zůstává bez diakritiky, bez XMP.
- 2026-09-26 — Claude Code (Mac) — Fáze 2b hotová: nahrazení fotky upravenou verzí se zachováním id/URL, textů, kolekcí a obalů; `sourceHash` pro detekci duplicit, `version` jako cache-buster (`?v=`), bezpečné generování do `<id>.new`. Nový test pokrývá zachování dat, změnu rozměrů a šířek, autora v nových souborech, duplicity obou verzí a chybové stavy. `npm test` 16/16. README + CLAUDE.md (datový model, invariant 8) doplněny.
- 2026-09-26 — uživatel → Claude Code — Požadavek na vlastní pořadí fotek (v kolekci i na hlavní stránce). Návrh zapsán jako fáze 4, otázka Q7. Z backlogu odstraněna duplicitní položka „Ruční řazení fotek v kolekci“.
- 2026-09-26 — uživatel — Q7 schválena (vlastní pořadí po nahrání fotek). Uživatel začal nahrávat fotky. Požadavek na hromadné vyplnění názvu, popisu a místa.
- 2026-09-26 — Claude Code (Mac) — Fáze 2c hotová: hromadné vyplnění názvu/popisu/místa v multivýběru, volba *jen prázdné*, `bulkPhotos({ set, onlyEmpty })` s whitelistem. `npm test` 17/17, ověřeno i v UI nad dočasnými daty.
- 2026-09-26 — Claude Code (Mac) — Fáze 2c: přidáno × pro hromadné vymazání pole (uživatel čekal, že smazání textu názvy odstraní). Test rozšířen, `npm test` 17/17, ověřeno v UI.
- 2026-09-26 — uživatel — × ověřeno. Požadavek: sjednotit multivýběr s autosave zbytku adminu, tlačítko Uložit není potřeba.
- 2026-09-26 — Claude Code (Mac) — Multivýběr ukládá po opuštění pole/Enteru, vyprázdnění pole i × maže hned, tlačítko Uložit odstraněno. Ověřeno skutečným psaním v UI (uložení, zachování fokusu, smazání, ×, *jen prázdné*). `npm test` 17/17.
- 2026-09-26 — uživatel — Nahráno 14 fotek ve 4 kolekcích, doplněny popisy a místa. Copyright změněn na „© Martin Porter“ (pseudonym). Názvy často nechá prázdné, aby neopakoval místo.
- 2026-09-26 — Claude Code (Mac) — Fáze 2d: fotka bez názvu se jmenuje podle místa; bezeztrátový přepis autora/copyrightu v existujících souborech, provedeno na 14 fotkách. Kód commitnut zvlášť od obsahu (`fac6c78` + tento commit). `npm test` 19/19.
- 2026-09-26 — uživatel — Nápad: režim celé obrazovky / skrytí popisu v prohlížeči fotky (na laptopu je na fotku málo místa). Zapsáno do fáze 3.
- 2026-09-26 — uživatel — První publikování (`f3daa45`): 14 fotek živě na foto.martinposta.com, OG tagy ověřeny na živé doméně (fotka, kolekce, galerie, og.jpg 200). Obava z limitu 1 GB → ukazatel velikosti v adminu, další možnosti až při přiblížení.
- 2026-09-26 — Claude Code (Mac) — Fáze 2e: ukazatel velikosti repa v adminu. `npm test` 20/20.
- 2026-09-26 — Claude Code (Mac) — Fáze 4 hotová: vlastní pořadí fotek pro Všechny fotky i každou kolekci. `npm test` 22/22.
- 2026-09-26 — Claude Code (Mac) — Oprava mřížky (hlášeno uživatelem po přeřazení kolekcí: dvě fotky na výšku pod sebou, zbytek nahoře). Chyba od verze 1: `appendTiles()` sčítala poměry stran, ale porovnávala s tolerancí 1 (= celá čtvercová fotka), takže sloupec dostal další fotku, až když byl o celou fotku kratší. Teď výšky v pixelech včetně mezery, tolerance 1 px. Pořadí jen chybu zviditelnilo. Ověřeno měřením sloupců při 1440 px (Zlatá řeka VYS | šir | šir+VYS, Nízke Tatry VYS | 3× šir | VYS).
- 2026-09-26 — uživatel — Sdílení v Messengeru/WhatsAppu ověřeno, OK. Hlášeno: na telefonu při swipování občas zůstala v pozadí předchozí fotka. Požadavek: kolekce abecedně (D14).
- 2026-09-26 — Claude Code (Mac) — Lightbox: pro každou fotku nový `<img>` (výměna `src` na stejném prvku nechávala předchozí fotku na obrazovce a pozdní `load` staré fotky rušil ztmavení nové). Kolekce abecedně: pole v datech drženo seřazené (`byTitle`, `localeCompare('cs')`), štítky kolekcí u fotky v lightboxu ve stejném pořadí, `/api/collections/reorder` a tlačítka ↑/↓ odstraněny. `npm test` 23/23.
- 2026-09-26 — Claude Code (Mac) — Lightbox: celá obrazovka (⛶/F) a skrytí popisu (ⓘ/I). Změřeno při výšce okna 768 px: fotka 516 px normálně, 698 px bez popisu, 768 px na celou obrazovku. Z fáze 3 zbývá Q1 (hlavička), Q2 (písmo), favicon (teď obecná ikona fotoaparátu).
- 2026-09-26 — uživatel — Q1 avatar, Q2 písmo jako teď, favicon fotoaparát. Nový požadavek: zvýrazněné kolekce (★ na začátek).
- 2026-09-26 — Claude Code (Mac) — Zvýrazněné kolekce (D15): `collection.starred`, řazení ★ napřed a pak abecedně, zaškrtávátko v nastavení kolekce, ★ v levém panelu adminu; na webu ★ + rámeček u štítku, ★ v přehledu kolekcí a u fotky. Písmo Inter self-hosted (D16), ověřeno: načte se z webu, žádný externí požadavek, obsahuje české znaky. Fáze 3 hotová. `npm test` 24/24.
- 2026-09-27 — uživatel — Ověřeno po publikování: swipování na iPhonu (Brave i Safari) bez předchozí fotky v pozadí, celá obrazovka na notebooku, přeřazené kolekce se vyplňují, písmo Inter na Windows OK.
- 2026-09-27 — uživatel — Chce: hromadné datum, celý web anglicky (adresy klidně změnit, nic nesdíleno), statistiku přes Cloudflare. Mapa míst není potřeba (vyřazeno). Dotaz na HEIC.
- 2026-09-27 — Claude Code (Mac) — Hromadné datum pořízení v multivýběru. Veřejný web anglicky, `/collections/`, starý `docs/kolekce/` se maže. Cloudflare Web Analytics přes token v nastavení (vloží se i celý skript z Cloudflare, token se z něj vytáhne), nenačítá se na localhost. `npm test` 27/27.
- 2026-09-27 — uživatel — Nápad: skupiny kolekcí podle místa; skupina klikací (ano), ★ nahoře mimo skupiny.
- 2026-09-27 — Claude Code (Mac) — Skupiny kolekcí (D20): pole Skupina s nabídkou existujících, levý panel adminu s nadpisy skupin, na webu štítek skupiny v řádku, stránky `/groups/<slug>/`, sekce v přehledu kolekcí, odkaz na skupinu nad názvem kolekce. Test řazení, dat i stránek. Ověřeno v UI nad dočasnými daty (desktop i 375 px). `npm test` 28/28. Otevřené: pořadí fotek na stránce skupiny zatím nejde ručně měnit (skládá se z pořadí kolekcí).
- 2026-09-27 — Claude Code (Mac) — Skupina rovnou při zakládání kolekce (multivýběr i dialog *+ nová*, s nabídkou existujících skupin); nabídka „Přidat do kolekce“ rozdělená podle skupin. `npm test` 29/29.
- 2026-09-27 — uživatel — Dotaz na přejmenování kolekce; chce přesměrování „pro jistotu“ a přejmenování skupiny (nešlo).
- 2026-09-27 — Claude Code (Mac) — D21: `data.redirects`, přesměrovací stránky při změně adresy kolekce a přejmenování skupiny (bez řetězení, zrušení když je adresa zase živá, jen dokud cíl existuje), přejmenování/slučování skupin z nadpisu v levém panelu adminu. Ověřeno v prohlížeči: `/groups/czech-rep/` skončí na `/groups/czech-republic/`. `npm test` 30/30.
- 2026-09-27 — Claude Code (Mac) — PLAN srovnán pro plánovací konverzaci: nový souhrn *Stav k 2026-09-27*, sekce *Poznatky*, *Další kroky*, dokončené fáze přesunuty do archivu, D7/D9/D14 aktualizovány podle pozdějších rozhodnutí, Q4 uzavřena, backlog doplněn.
- 2026-09-27 — plánování — Vyhledávače OK (D22). E-mail z commitů pryč přes noreply a novou historii (D23, fáze 5). Koncepty mimo git (D24, fáze 6). Návrh přesunu adminu na Proxmox jako jediné instance (fáze 7, Q10). Otevřeny Q8–Q11.
- 2026-09-27 — plánování — Q8–Q11 vyřešeny: autor commitů Martin Porter (D23), kontakt přes alias Cloudflare Email Routing (D26, fáze 5b), synchronizace instancí přes GitHub (D25, fáze 7a, nápad uživatele), admin hlavně na Proxmoxu (7b), koncepty s tlačítkem *Potvrdit nové fotky*. `PLAN.md` ve složce byl nalezen vrácený na verzi z 2026-09-26 večer (ostatní soubory aktuální). Obnoven z kopie v plánování, změny Claude Code po 2026-09-27 12:45 by v něm chyběly.
- 2026-09-27 — plánování — Plán dokončen pro předání: sekce *Předání pro Claude Code*, fáze 5 přeřazena (nastavení soukromí e-mailu na GitHubu až po vytvoření nové historie, jinak by blokovalo publikování), návaznosti konceptů na existující funkce, anglický štítek kontaktu, slabé místo konceptů přijato uživatelem (D24), zápis o vracení `PLAN.md`.
- 2026-09-27 — Claude Code (Mac) — Přečteno zadání fází 5–7b. Ověřeno: osobní e-mail je jen v metadatech všech 21 commitů, ve stromu souborů není. Doména má MX `mxredir.wedos.net`, což mění fázi 5b (Q12). Otevřeny Q13–Q15 (koncepty a veřejné názvy kolekcí, umístění konceptů v adminu, konflikty generovaného `docs/` při synchronizaci). Zatím nic neprovedeno.
- 2026-09-27 — uživatel — Q12: pošta na Cloudflare Email Routing (vše kolem domény přenáší na Cloudflare). Q13–Q15 schváleny podle návrhů.
- 2026-09-27 — Claude Code (Mac) — Zapsán návod přechodu pošty z Wedosu na Cloudflare Email Routing (fáze 5b). Ověřeno: DNS na Cloudflare, jediný MX `mxredir.wedos.net`, žádné SPF/DMARC, portfolio skládá osobní Gmail, žádnou adresu z domény.
- 2026-09-27 — uživatel — Řádek štítků nejde myší posouvat (jen touchpadem). Zjednodušit řádek: jen skupiny (+ ★ kolekce).
- 2026-09-27 — Claude Code (Mac) — D27: řádek = ★ kolekce | skupiny | kolekce bez skupiny, u kolekce ve skupině svítí skupina; kolečko myši posouvá řádek vodorovně, na konci pustí stránku (ověřeno událostmi i na datech uživatele: 7 skupin + 3 kolekce bez skupiny, při 1280 px přečnívá jen poslední). Necommitováno, půjde do nové historie ve fázi 5.
- 2026-09-27 — Claude Code (Mac) — Řádek štítků: šipky ‹ › (jen na straně se schovanými štítky, posun o 70 % šířky, na dotyku skryté), tažení myší (od 5 px, klik po tažení se nepočítá, obyčejný klik funguje), ztmavení okraje jen na té straně. Ověřeno událostmi na datech uživatele. Necommitováno.
- 2026-09-27 — uživatel — Šipky, tažení a kolečko v řádku štítků ověřeny, fungují. Pokračovat fází 5.
- 2026-09-27 — Claude Code (Mac) — Fáze 5, kroky 1–3: noreply `33331553+martinposta@users.noreply.github.com` (odvozeno přes `gh api user`, id + login), `git config` jen pro toto repo: `Martin Porter <…noreply…>` (globální nastavení beze změny). Strom bez osobního e-mailu (`git grep`). **Záloha:** `/Users/martin/Desktop/Martin/Fotogalerie-zaloha-2026-09-27` (217 MB, celá složka včetně `.git` s 22 commity, `git fsck` OK). Poslední commit se starou historií: `9c17a70` (publikováno uživatelem 18:17, na GitHubu).
- 2026-09-27 — Claude Code (Mac) — Fáze 5, krok 4 (potvrzeno uživatelem): `.git` smazán, nová historie s jedním commitem, autor i committer `Martin Porter <33331553+martinposta@users.noreply.github.com>`. Strom je shodný se starým `9c17a70` kromě `PLAN.md`. Nic zatím neodesláno. Admin zastaven do založení nového repa (publikování do starého repa by GitHub odmítl, historie nenavazuje).
