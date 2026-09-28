# Foto galerie

Osobní fotogalerie ve stylu Unsplash. Běží zdarma na **GitHub Pages**. Fotky spravuješ v jednoduchém **lokálním adminu** na svém PC: přetáhneš fotky, doplníš názvy, popisky a kolekce a klikneš **Publikovat na GitHub**.

- Originály nikam nenahráváš. Na web jde jen zmenšená WebP verze (max. 2400 px) a malý JPEG pro náhled při sdílení.
- GPS a ostatní metadata se z webových verzí odstraní. EXIF údaje (fotoaparát, objektiv, expozice) se ukážou jako text pod fotkou.
- Každá fotka i kolekce má vlastní odkaz s náhledovým obrázkem pro Messenger, WhatsApp a další.
- Admin běží jen na tvém počítači (`localhost`), takže nepotřebuje přihlašování.

---

## Fáze 0 — co je potřeba (jednorázově)

Galerie běží na **macOS i Windows**. Postup níž je pro Mac, rozdíly pro Windows jsou vždy pod ním.

1. **Node.js 20 nebo novější** (doporučeno LTS): https://nodejs.org, instalátor nech na výchozích volbách
2. **Git**
   - **Mac:** v Terminálu spusť `git --version`. Když git chybí, macOS sám nabídne instalaci nástrojů pro vývojáře (nebo `xcode-select --install`).
   - **Windows:** Git for Windows z https://git-scm.com/download/win, vše nech výchozí. Obsahuje i přihlašování ke GitHubu.
3. Účet na **GitHubu** (ten máš)

Kontrola v Terminálu (Mac) nebo PowerShellu (Windows):

```bash
node -v
git --version
```

## Fáze 1 — spuštění lokálně

1. Nech složku galerie někde natrvalo, třeba `~/Desktop/Martin/Fotogalerie` (Windows: `D:\Projekty\foto-galerie`).
2. Spusť admin dvojklikem:
   - **Mac:** **`Galerie.command`**. Otevře se Terminál. Pokud macOS napoprvé odmítne soubor otevřít, klikni na něj pravým tlačítkem → **Otevřít** → **Otevřít**.
   - **Windows:** **`Galerie.cmd`**

   Při prvním spuštění se nainstalují závislosti (asi minutu), pak se v prohlížeči otevře admin na http://localhost:4321.

   Totéž ručně v Terminálu:

   ```bash
   cd ~/Desktop/Martin/Fotogalerie
   npm install
   npm run admin
   ```

3. Vyzkoušej nahrát pár fotek, vytvořit kolekci a otevřít **Náhled webu**. V náhledu vypadá galerie přesně jako online.

Admin ukončíš zavřením okna Terminálu (příkazové řádky), nebo `Ctrl+C`.

## Fáze 2 — propojení s GitHubem

1. Na https://github.com/new vytvoř repozitář:
   - **Repository name:** `foto` (název určuje adresu, viz fáze 3)
   - **Public** (GitHub Pages zdarma vyžaduje veřejné repo)
   - **Nezaškrtávej** README, .gitignore ani licenci
2. V Terminálu ve složce galerie (`<USER>` nahraď svým GitHub jménem):

   ```bash
   cd ~/Desktop/Martin/Fotogalerie
   git init -b main
   git remote add origin https://github.com/<USER>/foto.git

   # pokud jsi git na tomhle PC ještě nikdy nepoužil:
   git config --global user.name "Martin Pošta"
   git config --global user.email "tvuj@email.cz"
   ```

3. V adminu klikni **Publikovat na GitHub**.
   - **Windows:** při prvním odeslání se otevře okno pro přihlášení ke GitHubu. Přihlas se a Git si to zapamatuje.
   - **Mac:** git od Applu okno pro přihlášení neotevře. GitHub navíc nepřijímá heslo, jen token nebo SSH klíč. Nejjednodušší je jednou nainstalovat GitHub CLI a spustit `gh auth login` → *GitHub.com* → *HTTPS* → *Login with a web browser*. Git pak přihlášení převezme a admin publikuje bez ptaní. Pro jistotu ještě spusť `gh auth setup-git`: když v průvodci odpovíš na *Authenticate Git* „No“, git o přihlášení neví.
     GitHub CLI se instaluje přes `brew install gh`. Na **Macu s Intelem** ale Homebrew už nemá hotové balíčky, takže by kompiloval celý Go (desítky minut). Tam je rychlejší instalátor `.pkg` (macOS, amd64) z https://github.com/cli/cli/releases/latest.
4. Na GitHubu v repu otevři **Settings → Pages**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`, složka **`/docs`** → **Save**

   Za minutu až dvě je galerie online.

## Fáze 3 — adresa (doména)

**Zvoleno: varianta B, https://foto.martinposta.com** (od 2026-09-26). Portfolio běží z repa `portfolio`, ne z `martinposta.github.io`, takže varianta A by vyžadovala přejmenování repa portfolia. Záznam `foto` v Cloudflare musí zůstat *DNS only*.

### Varianta A: `www.martinposta.com/foto` (u tebe nepoužitá)

Funguje automaticky, pokud portfolio `martinposta.com` běží z repozitáře pojmenovaného **`<USER>.github.io`** s nastavenou vlastní doménou. GitHub pak každé další repo s Pages zpřístupní jako podsložku: repo `foto` → `www.martinposta.com/foto/`.

- Ověříš to v repu portfolia v **Settings → Pages**: repo se jmenuje `<USER>.github.io` a má custom domain `www.martinposta.com`.
- V adminu v **Profil a nastavení** vyplň *Veřejná adresa galerie* = `https://www.martinposta.com/foto/` a publikuj.

Pokud je portfolio v repu s jiným názvem, tohle nefunguje. Pak použij variantu B.

### Varianta B: `foto.martinposta.com`

1. U správce DNS (u `martinposta.com` je to **Cloudflare**) přidej záznam: **CNAME** `foto` → `<USER>.github.io`. V Cloudflare ho nech jako **DNS only** (šedý mráček), jinak GitHub nevystaví HTTPS certifikát.
2. V adminu v **Profil a nastavení** vyplň:
   - *Vlastní subdoména* = `foto.martinposta.com`
   - *Veřejná adresa galerie* = `https://foto.martinposta.com/`
3. Publikuj. Na GitHubu v **Settings → Pages** se doména sama doplní. Až GitHub vystaví certifikát (minuty až hodina), zaškrtni **Enforce HTTPS**.

---

## Každodenní použití

1. `Galerie.command` na Macu, `Galerie.cmd` na Windows (nebo `npm run admin`)
2. Přetáhni fotky do pole nahoře. Když máš vlevo vybranou kolekci, fotky se do ní rovnou přidají. **Nové fotky jsou nejdřív koncepty** (štítek *koncept*, jsou v mřížce nahoře a v levém panelu pod *Koncepty*). Na webu ani na GitHubu nejsou, dokud je nepotvrdíš: tlačítkem **Potvrdit nové fotky** nahoře, **Zveřejnit** u fotky, nebo rovnou při *Publikovat* volbou **Potvrdit a publikovat**. Kolekce, ve které jsou jen koncepty, je taky skrytá (v levém panelu kurzívou). Zveřejněnou fotku jde *Vrátit do konceptů*, ale verze, která už na GitHubu byla, zůstane v historii gitu. Koncepty nejsou zálohované na GitHubu.
3. Klikni na fotku a doplň název, popis, místo a kolekce. Ukládá se samo.
   - **Cmd/Ctrl/Shift + klik** vybere víc fotek naráz. Hromadně jim pak vyplníš název, popis, místo a datum pořízení, přidáš je do kolekce nebo je smažeš, případně je přetáhneš na kolekci vlevo. Pole se uloží všem vybraným fotkám, jakmile klikneš vedle nebo zmáčkneš Enter. Smazaný text pole u všech vymaže, stejně jako **×**. Volba *Jen u fotek, kde je pole prázdné* nepřepíše, co už máš vyplněné.
   - **★** u kolekce v editoru fotky nastaví obal kolekce.
   - Když v *Profil a nastavení* změníš jméno nebo copyright, platí to pro nově nahrané fotky. Tlačítko **Použít jméno a copyright i u nahraných fotek** je přepíše i ve fotkách, které už na webu jsou, bez ztráty kvality. Po publikování to ale zvětší repozitář o velikost všech fotek, proto to nedělej zbytečně často.
   - **Pořadí:** fotky se řadí automaticky podle data (nebo nahrání, viz nastavení). Když fotku v mřížce **přetáhneš** jinam, seznam si od té chvíle drží tvoje pořadí. *Všechny fotky* a každá kolekce mají pořadí samostatné. Vybraným fotkám můžeš dát i **Na začátek**, **Na konec** nebo **Zařadit podle data** (hodí se na dohledané starší fotky: přesunou se mezi fotky ze stejné doby a zbytek pořadí zůstane). Nově nahrané fotky se ve vlastním pořadí objeví na začátku. Odkaz *vrátit podle data* pod nadpisem obnoví automatické řazení.
   - **Skupina** v nastavení kolekce (*Upravit kolekci*), třeba „Czech Republic“ nebo „Slovakia“: kolekce se stejnou skupinou se řadí k sobě a skupina má na webu vlastní stránku (`…/groups/czech-republic/`) se všemi fotkami svých kolekcí. Admin nabízí už použité skupiny, aby nevznikly dvě podobné. **Přejmenovat skupinu** (třeba při překlepu) jde kliknutím na její nadpis v levém panelu. Přejmenují se všechny její kolekce najednou a zadáním názvu jiné skupiny se dvě skupiny sloučí. Skupinu můžeš zadat rovnou při zakládání nové kolekce: v multivýběru („…nebo do nové kolekce“) i v dialogu *+ nová*. Kolekce bez skupiny jsou na konci.
   - **★ Zvýraznit** v nastavení kolekce (*Upravit kolekci*) posune kolekci na začátek. Zvýrazněných může být víc, mezi sebou se řadí abecedně, ostatní kolekce abecedně za nimi. Na webu mají hvězdičku a rámeček. V řádku pod hlavičkou webu jsou jen zvýrazněné kolekce, skupiny a kolekce bez skupiny. Ostatní kolekce najde návštěvník na stránce skupiny. Když se řádek nevejde, dá se posouvat kolečkem myši, tažením nebo šipkami na jeho koncích (na mobilu prstem). Hodí se na poslední výlet nebo oblíbené fotky.
   - **Použít jako náhled webu** vybere obrázek, který se ukáže při sdílení odkazu na celou galerii.
   - **Nahradit soubor…** nahraje upravenou verzi fotky (třeba po nových barevných korekcích nebo ořezu v Capture One) místo původní. Název, popis, kolekce i odkaz na fotku zůstanou. Novou verzi můžeš i přetáhnout na náhled v editoru.
4. **Náhled webu ↗** pro kontrolu
5. **Publikovat na GitHub**. Za minutu je změna online.

**Tip:** Pokud vyplňuješ název a popis už v Lightroomu, darktable, digiKamu nebo ve Windows (Vlastnosti → Podrobnosti), admin si je při nahrání načte sám.

## Prohlížení fotek

V detailu fotky:

- **šipky** nebo **swipe** listují,
- **F** nebo ⛶ zapne celou obrazovku, kde je jen fotka a ovládání se po chvíli schová,
- **I** nebo ⓘ schová popis, aby měla fotka víc místa (prohlížeč si to pamatuje),
- **Esc** ukončí celou obrazovku, druhým stiskem se detail zavře.

## Změna adres

Přejmenování kolekce její adresu nemění. Adresa kolekce se změní, jen když ji sám přepíšeš v *Upravit kolekci → Adresa*. Adresa skupiny se mění s jejím názvem. V obou případech si admin pamatuje starou adresu a nechá na ní stránku, která návštěvníka hned pošle na novou, včetně náhledu pro sdílení. Už poslané odkazy tak fungují dál.

## Víc kopií adminu (synchronizace s GitHubem)

GitHub je hlavní kopie galerie. Admin se s ním srovnává sám:

- **Při spuštění** stáhne, co mezitím publikovala jiná kopie (třeba admin na serveru), pokud nemáš nepublikované úpravy.
- **Průběžně** (každých 5 minut a při návratu do okna) se ptá GitHubu. Když je tam něco nového, v horní liště se objeví **↓ Synchronizovat**. Když máš zároveň nepublikované úpravy, uvidíš **↓ … na GitHubu · publikuj**.
- **Publikovat** vždycky nejdřív stáhne novější stav z GitHubu a spojí ho s tvými změnami. Úpravy různých polí téže fotky (třeba popis na jedné kopii, místo na druhé) se spojí samy. Jen když obě kopie změní **totéž pole** na něco jiného, publikování se zastaví, nic neodešle a tvoje změny zůstanou. To se vyřeší v Claude Code.
- **Koncepty se nesynchronizují.** Zůstávají v kopii adminu, kde vznikly.
- Pokud z GitHubu přijde nový kód adminu, v liště se objeví **Nový kód · restartuj admin** (zavřít a znovu spustit `Galerie.command`).

Nejjednodušší návyk: publikovat často. Co je publikované, je na GitHubu i v každé další kopii.

## Kontaktní e-mail

V *Profil a nastavení → Kontaktní e-mail* vyplň `foto@martinposta.com`. Na webu se v profilu objeví odkaz **Email**. Adresa se ukládá rozdělená a celá vznikne až v prohlížeči návštěvníka, takže ji roboti sbírající e-maily nenajdou ve stránkách ani v repu. Pošta chodí přes Cloudflare Email Routing do Gmailu (návod v PLAN.md, fáze 5b).

## Statistika návštěv

Volitelně přes **Cloudflare Web Analytics**: bez cookies, zdarma, doménu už na Cloudflare máš.

1. V Cloudflare otevři **Analytics & Logs → Web Analytics → Add a site** a zadej `foto.martinposta.com`.
2. Cloudflare ukáže kousek kódu se `"token": "…"`. Zkopíruj ho celý (nebo jen token) do adminu: *Profil a nastavení → Statistika návštěv*.
3. Publikuj. Návštěvy pak uvidíš v Cloudflare ve Web Analytics. Tvoje prohlížení náhledu v adminu se nepočítá.

## Odkazy na webu

| Adresa | Co ukáže |
|---|---|
| `foto.martinposta.com/` | všechny fotky |
| `…/collections/` | přehled kolekcí |
| `…/collections/sumava/` | jedna kolekce |
| `…/f/<id>/` | jedna fotka (tlačítko sdílet v prohlížeči fotek) |

## Limity a údržba

- GitHub doporučuje repo do **1 GB**. Jedna fotka zabere na webu podle obsahu zhruba 0,5–1,5 MB (na tvých fotkách průměrně 1,06 MB), takže se vejde přibližně 700–1500 fotek.
- **Kolik je zabráno**, ukazuje admin nahoře vedle stavu publikování („20 MB z 1 GB“). Počítá celou historii gitu i fotky, které publikování teprve přidá. Od 70 % zoranžoví, od 90 % zčervená. Při překročení GitHub pošle upozornění e-mailem, web nespadne.
- Smazaná nebo nahrazená fotka zmizí z webu, ale zůstane v historii gitu. Repo se tím nezmenší. Totéž platí pro přepis autora u nahraných fotek.
- **Kdyby se limit blížil**, jsou dvě cesty: přesunout obrázky jinam (např. Cloudflare R2, 10 GB zdarma, nebo vlastní server) a web nechat na GitHubu, nebo začít s čistým repem bez historie. Obojí se řeší s Claude Code, data v `data/gallery.json` zůstanou.
- `data/gallery.json` obsahuje všechny popisky a kolekce a je v gitu. GitHub je tak zároveň záloha.
- **HEIC** (iPhone) není podporovaný. Vyexportuj JPG.

## Úpravy

| Co | Kde |
|---|---|
| Vzhled veřejného webu | `site/style.css`, `site/app.js`, `site/index.html` → pak `npm run rebuild` |
| Velikosti, kvalita, formát (WebP/AVIF) | `lib/config.mjs` (platí pro nově nahrané fotky) |
| Port adminu | Mac: `PORT=5000 npm run admin` · Windows: `$env:PORT=5000; npm run admin` |
| Automatické testy | `npm test` (asi 15 s, na tvoje data nesahají) |

## Struktura

```
foto-galerie/
  Galerie.command    dvojklik = spustit admin (Mac)
  Galerie.cmd        dvojklik = spustit admin (Windows)
  CLAUDE.md          instrukce pro Claude Code
  PLAN.md            rozhodnutí, stav a další kroky
  tests/             automatické testy (npm test)
  admin/             lokální admin (server + UI), na web nejde
  lib/               zpracování fotek, generování webu
  site/              šablona veřejného webu
  data/gallery.json  popisky, kolekce, nastavení (zdroj pravdy)
  docs/              VYGENEROVANÝ web, tohle servíruje GitHub Pages (needitovat ručně)
```

## Řešení problémů

- **Mac: „Galerie.command nelze otevřít“**: pravý klik → Otevřít. Když hlásí chybějící oprávnění, spusť v Terminálu ve složce galerie `chmod +x Galerie.command`.
- **„Port 4321 je obsazený“**: admin už běží v jiném okně. Otevři http://localhost:4321.
- **Publikování selže s `rejected` / `fetch first`**: na GitHubu je změna, kterou nemáš lokálně. Spusť `git pull --rebase` a publikuj znovu.
- **„Git nezná tvé jméno“**: spusť dva `git config --global …` příkazy z fáze 2.
- **Mac: publikování selže s `could not read Username` / `Authentication failed`**: git nemá přihlášení ke GitHubu. Spusť `gh auth login` (fáze 2, bod 3) a publikuj znovu.
- **Web ukazuje 404**: zkontroluj v **Settings → Pages** větev `main` a složku `/docs` a počkej 1–2 minuty.
- **Sdílený odkaz nemá obrázek**: vyplň *Veřejná adresa galerie* v nastavení a publikuj. Messenger si náhledy cachuje, u už sdílených odkazů může chvíli trvat, než se obnoví.
