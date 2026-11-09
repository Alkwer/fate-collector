# Audyt repozytorium Fate Collector — 2026-11-09

Przegląd wskazał **14 zadań: 1 × P1, 9 × P2 i 4 × P3**. Poniżej zachowano pierwotne ustalenia; aktualny stan realizacji opisuje następna sekcja.

Stan odniesienia audytu: commit `53fb4d6` (`Fix offered card row selection and retry failed autosaves`). Implementację wykonano po ponownym sprawdzeniu `origin/main`, na bazie `2104ee0` (`Fix offered-card parsing and capture persistence (#7)`). Numery linii w pierwotnych ustaleniach odnoszą się do stanu audytu.

## Realizacja — 2026-11-09

| ID | Stan | Zmiana i weryfikacja |
| --- | --- | --- |
| A01 | Naprawione | Tombstone usuniętej oferty w IndexedDB v3; regresje storage oraz dwóch kart dla ręcznego i automatycznego zapisu. Jawny import nadal przywraca dane. |
| A02 | Naprawione | Trwałe unieważnianie cache po imporcie i powiadomienie UI o odzyskanym evidence; test tej samej sesji połączenia. |
| A03 | Naprawione | Atomowa kontrola właściciela capture i niezmienności referencji; migracja 0007 zachowuje historię, ujawnia konflikty i liczy jeden kanoniczny rekord. Regresje współbieżnych zgłoszeń i historycznych kolizji. |
| A04 | Naprawione | Eksport dzielony według rzeczywistego rozmiaru UTF-8; pobranie i odtworzenie dużego zbioru w testach desktop/mobile. |
| A05 | Naprawione | Odzyskiwanie receiptów i retry z zachowaniem uszkodzonych oryginałów; uszkodzona blokada zatrzymuje wysyłkę do nowej świadomej zgody. Testy PowerShell. |
| A06 | Naprawione | Ścisłe dekodowanie UTF-8 kieruje uszkodzony stan do odzyskiwania; błąd dostępu do pliku nie jest mylony z uszkodzeniem. Testy PowerShell. |
| A07 | Wzmocnione | GDI sprawdza przecinające okna przed i po kopii; automatyczny SDR przechodzi na WGC okna tylko dla wykrytej nakładki. Natywne próby zwykłej i przezroczystej nakładki przeszły. Pozostałe ograniczenia poniżej. |
| A08 | Naprawione | Izolowane dekodowanie historii; zachowanie uszkodzonych wpisów i kontynuowanie poprawnych wycofań. Testy klienta i diagnostyki. |
| A09 | Zrealizowane | Eksport receiptów bez tokenów oraz usuwanie lokalnych rekordów po potwierdzonym wycofaniu; ochrona przed późnym potwierdzeniem i ponowną wysyłką. |
| A10 | Częściowo; walidacja otwarta | Dodano rygorystyczny evaluator niezależnego holdoutu, macierz profili i testy. Brak dostępnych niezależnych dodatnich scen gry i rzeczywistego HDR; nie zastąpiono ich skalowanymi fixture. |
| A11 | Zrealizowane | CI instaluje AHK 2.0.31 ze sprawdzeniem SHA-256 i uruchamia istniejące testy kalibracji/składni. |
| A12 | Zrealizowane | Powtarzalne pomiary 1 tys./10 tys. plików i optymalizacja bez nowego indeksu. [Wyniki i ograniczenia](scan-performance.md). |
| A13 | Naprawione | Błąd wskazuje nadmiar linii albo konkretną linię ponad 1 000 znaków; tekst zostaje w edytorze, zapis wznawia się po korekcie. |
| A14 | Zrealizowane | `useOfferDraft` skupia sesję edycji, zapis, konflikty i ochronę nowych zmian; istniejące regresje przepływów pozostają wymagane. |

Testy natywne WGC obejmują SDR i wymuszoną ścieżkę float16 na SDR. Systemowa warstwa na tym komputerze uniemożliwiła końcową próbę czystego GDI; test jawnie raportuje pominięcie, a opcja `-RequireCleanGdi` wymaga jej przed wydaniem. Krótkotrwała nakładka istniejąca wyłącznie pomiędzy kontrolami GDI nadal jest możliwa; wymuszone WGC izoluje okno. Tryby gry, rzeczywisty HDR i niezależna jakość rozpoznawania pozostają w [procedurze walidacji](recognition-validation.md). To ograniczenia testów, nie potwierdzenie gotowości do szerszego wydania.

Walidacja implementacji: `npm run check` (115 testów w 13 plikach, typy i build),
42 testy Playwright na lokalnym Workerze/D1, 36 testów Pythona, wszystkie siedem
zestawów helpera oraz integracja uploadu z D1. Po podniesieniu helpera do 0.3.1
ponownie sprawdzono capture z wymaganym Windows OCR. Obejrzano wyrenderowany eksport
przy szerokości 1440 i 390 px; testy potwierdzają pobranie wszystkich części,
odtworzenie 240 ofert, obsługę Escape, brak poziomego przepełnienia i błędów konsoli.
Walidator native holdout celowo nie przechodzi `--require-coverage` przy pustym
niezależnym korpusie; to jawny brak materiału, a nie test uznany za zaliczony.

## Zakres i sposób oceny

Przejrzano frontend React, IndexedDB, import/eksport, synchronizację folderu, kontrakty Zod, Worker, migracje D1, obsługę zgód i diagnostyki, skrypty wydania, CI, testy oraz dokumentację. Helper Windows otrzymał osobny przegląd, którego ustalenia zweryfikowano w kodzie. Prototyp rozpoznawania oceniono przez dokumentację metodologii i istniejące testy; nie przeprowadzono ponownego pomiaru jakości całego algorytmu.

Priorytety uwzględniają obecny zakres produktu: lokalny kolektor i zamknięta grupa zaufanych testerów, a nie publiczna usługa anonimowego zbierania danych.

| Priorytet | Znaczenie |
| --- | --- |
| P0 | Awaria krytyczna wymagająca natychmiastowej reakcji. W tym przeglądzie nie potwierdzono takiego problemu. |
| P1 | Naprawić w najbliższej poprawce; problem narusza integralność podstawowego przepływu danych. |
| P2 | Zaplanować w kolejnym etapie; istotna niezawodność, jakość danych, odzyskiwanie lub walidacja przed szerszym użyciem. |
| P3 | Usprawnienie utrzymania, ergonomii lub wydajności; realizować po pilniejszych poprawkach, a optymalizację poprzedzić pomiarem. |

„Odtworzone” oznacza uruchomiony scenariusz kontrolny. „Analiza kodu” oznacza potwierdzoną konstrukcję i wynikający z niej scenariusz, bez odtworzenia pełnego przepływu w UI lub systemie. „Usprawnienie” i „luka walidacji” nie oznaczają zaobserwowanej awarii.

## Lista do realizacji

Poniżej pierwotna lista z priorytetami. Aktualny stan określa tabela realizacji powyżej.

| ID | Priorytet | Zadanie | Podstawa |
| --- | --- | --- | --- |
| A01 | **P1** | Zablokować odtwarzanie usuniętej oferty przez zapis ze starej karty | Odtworzone, IndexedDB |
| A02 | **P2** | Odświeżać stan synchronizacji po przywróceniu metadanych | Odtworzone, czytnik folderu |
| A03 | **P2** | Ustalić i egzekwować unikalność sprawdzonej obserwacji względem capture | Odtworzone, schemat i SQLite |
| A04 | **P2** | Zapewnić eksport całego dopuszczalnego zbioru w mniejszych częściach | Odtworzone, eksport |
| A05 | **P2** | Odzyskiwać uszkodzone metadane zgód i wycofań helpera | Analiza kodu |
| A06 | **P2** | Obsłużyć niepoprawne UTF-8 w stanie pojedynczej pozycji kolejki | Analiza kodu |
| A07 | **P2** | Wzmocnić ochronę przechwytywanego obszaru przed nakładkami | Analiza kodu; potrzebny test ekranowy |
| A08 | **P2** | Izolować uszkodzone wpisy lokalnej historii zgód i diagnostyki | Analiza kodu |
| A09 | **P2** | Dodać bezpieczne archiwizowanie zamkniętej historii diagnostycznej | Usprawnienie |
| A10 | **P2** | Uzupełnić walidację na rzeczywistych dodatnich próbkach gry, HDR i skalach UI | Luka walidacji |
| A11 | **P3** | Włączyć istniejące testy AHK i kalibracji do CI | Luka CI |
| A12 | **P3** | Zmierzyć i ograniczyć koszt pełnego skanowania archiwum capture | Usprawnienie wydajności |
| A13 | **P3** | Uzgodnić walidację pól edytora z kontraktem danych | Analiza kodu / ergonomia |
| A14 | **P3** | Wydzielić sterowanie edycją i zapisem z głównego komponentu | Usprawnienie utrzymania |

### A01 · P1 · Zapis ze starej karty odtwarza usuniętą ofertę

**Miejsce:** `src/lib/storage.ts:76`, `:85`, `:147`; wywołania zapisu w `src/App.tsx:87` i `:175`.

**Problem i skutek:** kontrola rewizji działa tylko wtedy, gdy rekord nadal istnieje. Po usunięciu oferty w karcie A karta B może zapisać wcześniej otwarty draft. `saveOffer()` traktuje brak rekordu jako nową ofertę i odtwarza także przekazane evidence. Zostaje przy tym zgubiony lokalny stan wcześniejszego udostępnienia. Receipt chroniący przed ponownym importem z folderu nie jest sprawdzany przez zwykły zapis.

**Walidacja:** `saveOffer → deleteOffer → saveOffer(stary draft)` ponownie utworzyło rekord w `fake-indexeddb`. To odtworzenie logiki zapisu, nie nowy test dwukartowego UI.

**Zmiana:** rozróżnić tworzenie nowej oferty od aktualizacji wcześniej istniejącej. Aktualizacja nieistniejącego rekordu powinna zgłosić konflikt/usunięcie, zachowując draft. Jawny import przywracający dane musi pozostać osobną dozwoloną operacją. Powiadomienia między kartami mogą poprawić UX, ale warunek należy egzekwować atomowo w warstwie przechowywania.

**Gotowe, gdy:** zarówno ręczny zapis, jak i autozapis ze starej karty nie odtwarzają usuniętego rekordu; draft można wyeksportować; świadome przywrócenie backupu nadal działa. Dodać regresję storage i scenariusz dwóch kart.

### A02 · P2 · Cache czytnika pomija odzyskanie evidence w tej samej sesji

**Miejsce:** `src/lib/capture-sync.ts:16`, `:28`, `:49`; `src/lib/storage.ts:163`; `src/App.tsx:122`.

**Problem i skutek:** `CaptureReader.handled` zapamiętuje ID i pomija je przed sprawdzeniem aktualnego stanu IndexedDB. Jeśli po przetworzeniu pliku użytkownik usunie ofertę i jawnie przywróci jej metadane, ten sam czytnik nie odzyska obrazu z pliku nadal leżącego w folderze. Ponowne połączenie lub przeładowanie tworzy nowy czytnik i usuwa tę przeszkodę. Dodatkowo przywrócenie samego evidence zwraca `created = false`, więc callback `onSaved` nie powiadamia UI o zmianie.

**Walidacja:** dwa skany tym samym czytnikiem rozdzielone usunięciem i importem metadanych pozostawiły `getEvidence() === null`. Skan nową instancją odzyskał evidence. W próbie podmieniono wyłącznie dekodowanie wejściowego obrazu; czytnik i storage były rzeczywiste.

**Zmiana:** unieważniać odpowiednie ID po przywróceniu danych lub oprzeć cache na wersji lokalnego stanu. Rozróżnić rezultat „nowa oferta”, „odzyskano evidence” i „bez zmian”, tak aby UI mogło odświeżyć obraz.

**Gotowe, gdy:** odzyskany z backupu rekord otrzymuje brakujące evidence i pokazuje je bez odłączania folderu lub odświeżania strony; zwykłe usunięcie nadal nie powoduje automatycznego odtworzenia.

### A03 · P2 · Dwie sprawdzone oferty mogą podwójnie liczyć ten sam capture

**Miejsce:** `migrations/0002_capture_uploads.sql:16`, `worker/index.ts:77`, `shared/schema.ts:56`; porównawczo `scripts/research-corpus-stats.mjs:13`.

**Problem i skutek:** widok `research_observations` usuwa z wyniku surowy capture zastąpiony sprawdzoną ofertą, ale zwraca wszystkie wiersze `latest_observations`. Dwie oferty z różnymi `id` i tym samym `captureId` pozostają dwoma obserwacjami. Kontrakt i ścieżka zapisu API nie wymagają unikalnego przypisania capture do jednego ID oferty. Lokalny skrypt statystyk odrzuca taki zbiór, więc warstwy nie mają jednakowej reguły.

**Walidacja:** dwa rekordy poprawne według `offerSchema`, wstawione do SQLite po migracjach 0001–0002, dały dwa wiersze widoku dla jednego `captureId`. Nie odtwarzano tego przez wdrożone API. Zwykły import helpera nadaje `offer.id = captureId`, więc problem dotyczy innych wejść dopuszczanych przez kontrakt, a nie każdego importu.

**Zmiana:** ustalić jeden kanoniczny ID oferty dla capture i egzekwować go przy zapisie albo jawnie rozstrzygać kolizje. Przed dodaniem ograniczenia sprawdzić istniejące dane; zachować rewizje i pochodzenie zamiast bezwarunkowo usuwać duplikaty. Dla ofert ręcznych bez `captureId` pozostawić dotychczasową semantykę.

**Gotowe, gdy:** dwa różne ID wskazujące ten sam capture nie zwiększają liczby niezależnych obserwacji; API, widok badawczy i raport statystyk stosują tę samą regułę. Test powinien objąć także dwie równoczesne próby zapisu.

### A04 · P2 · Poprawny lokalny zbiór może nie dać się wyeksportować zbiorczo

**Miejsce:** `src/lib/imports.ts:61`, `shared/schema.ts:3`, `src/App.tsx:235`.

**Problem i skutek:** limit 250 ofert nie gwarantuje zmieszczenia eksportu w 12 MiB. `Export all data` przekazuje wszystkie metadane naraz. Po przekroczeniu limitu komunikat radzi eksport bez obrazów z historii, choć użytkownik właśnie korzysta z tej opcji. Nie ma wyboru zakresu ani automatycznego podziału backupu. Pozostaje eksportowanie ofert pojedynczo.

**Walidacja:** 250 ofert spełniających kontrakt, każda z dwiema kartami i 30 modyfikatorami po 1000 znaków, przekroczyło limit bez jakichkolwiek obrazów. To przypadek graniczny dopuszczony przez schemat, nie stwierdzenie o typowym rozmiarze obecnych danych.

**Zmiana:** dzielić eksport na pliki mieszczące się w limicie importu albo dodać wybór zakresu i czytelny pomiar rozmiaru. Przy okazji warto umożliwić pełny backup z evidence jako osobnymi plikami w archiwum. Obecny brak obrazów w eksporcie historii jest udokumentowany; pełny backup to rozszerzenie funkcji, a nie ukryty błąd istniejącego kontraktu.

**Gotowe, gdy:** każdy zbiór, który aplikacja pozwala zapisać, można wyeksportować i przywrócić bez ręcznego otwierania 250 ofert. Test porównuje wszystkie metadane po przywróceniu; dla opcji pełnego backupu również evidence.

### A05 · P2 · Helper nie odzyskuje części uszkodzonych metadanych zgody

**Miejsce:** `helpers/CloudUpload.Common.ps1:175`, `:411`, `:455`; `helpers/Consent.Common.ps1:137`, `:164`; `helpers/FateCollector.ahk:319`.

**Problem i skutek:** niepoprawny JSON w `gate.json` lub `recorded.json` może przerywać kolejne przebiegi. Ponowna konfiguracja korzysta z części tych samych odczytów. Uszkodzone potwierdzenie wycofania albo plik retry powoduje pomijanie wycofania, mimo że właściwy marker i token mogą nadal być poprawne. Harmonogram AHK dodatkowo opiera część decyzji na samym istnieniu potwierdzenia.

**Podstawa:** analiza przepływu wyjątków; sprawdzono również w pamięci zachowanie parsera PowerShell dla uszkodzonego JSON. Nie przeprowadzono pełnej symulacji awarii tych plików w działającym uploaderze. Obecne testy kolejki i zgód przechodzą, ale nie obejmują tych wariantów.

**Zmiana:** walidować każdy rodzaj metadanych i rozdzielić uszkodzenie od przejściowego błędu I/O. Zachować uszkodzony plik do diagnostyki, a pomocnicze potwierdzenia odtworzyć przez idempotentne żądanie z tym samym ID. Przy nieczytelnym dowodzie zgody wysyłka capture musi pozostać wyłączona. Nie usuwać markerów wycofania ani tokenów w ramach ogólnego „resetu”.

**Gotowe, gdy:** testy uszkodzonych gate/receipt/retry pokazują czytelny stan, bezpieczne odzyskanie lub konkretną ścieżkę naprawy; poprawne wycofanie nadal dociera do serwera, a dane gry nie są wysyłane bez potwierdzonej zgody.

### A06 · P2 · Błąd UTF-8 omija istniejącą naprawę stanu kolejki

**Miejsce:** `helpers/CloudUpload.Common.ps1:65`, `:470`, `:486`; `helpers/tests/Test-CloudUpload.ps1:377`.

**Problem i skutek:** odczyt używa rygorystycznego UTF-8. Błąd dekodowania trafia do `catch { continue }`, zanim ustawione zostanie `damagedState`. Pozycja może być pomijana w każdym przebiegu, mimo że zachował się oryginalny capture i niezmieniony payload. Istniejąca ścieżka odzyskiwania obsługuje uszkodzony JSON, który udało się odczytać jako tekst.

**Podstawa:** analiza kodu i sprawdzenie wyjątku rygorystycznego dekodera na nieprawidłowym bajcie. Istniejący test obejmuje ucięty JSON w poprawnym UTF-8, nie uszkodzenie kodowania.

**Zmiana:** skierować `DecoderFallbackException` do kontrolowanej ścieżki uszkodzonego stanu. Oddzielnie obsłużyć chwilową blokadę pliku. Przed ponowieniem nadal porównywać payload z oryginalnym capture.

**Gotowe, gdy:** zły bajt UTF-8 nie pozostawia poprawnej pozycji w nieskończonym pomijaniu; zmodyfikowany payload nadal nie jest wysyłany, a inne pozycje są przetwarzane.

### A07 · P2 · Pięć punktów kontroli nie wyklucza nakładki w przechwytywanym panelu

**Miejsce:** `helpers/Export-FateCapture.ps1:69`, `:141`, `:153`, `:161`; `helpers/CaptureImage.cs:435`.

**Problem i skutek:** kontrola zasłonięcia sprawdza rogi i środek panelu. GDI pobiera piksele pulpitu, a WGC tworzy capture monitora. Małe okno always-on-top lub powiadomienie mieszczące się pomiędzy punktami może wejść do obrazu mimo pomyślnej kontroli. Przy włączonym uploadzie rozpoznany tekst nakładki może znaleźć się także w wysyłanym OCR.

**Podstawa:** potwierdzone w kodzie próbkowanie pięciu punktów i przechwytywanie monitora. Nie odtworzono powiadomienia na ekranie; nie stwierdzono faktycznego wysłania obcego tekstu.

**Zmiana:** zbadać przechwytywanie zweryfikowanego okna gry zamiast monitora. Dla backendu wymagającego pulpitu sprawdzać przecięcia obszaru z widocznymi oknami powyżej gry, uwzględniając wyścig między walidacją a kopiowaniem obrazu. Wybrać rozwiązanie na podstawie testu w obsługiwanych trybach gry.

**Gotowe, gdy:** kontrolowana nakładka poza pięcioma punktami nie trafia do zaakceptowanego capture/OCR; test obejmuje też czysty panel, SDR oraz dostępny backend WGC.

### A08 · P2 · Jeden uszkodzony wpis historii blokuje obsługę pozostałych

**Miejsce:** `src/lib/consent.ts:12`, `:17`, `:86`; `src/lib/diagnostics.ts:11`, `:15`, `:87`.

**Problem i skutek:** `consentRecords()` i `diagnosticHistory()` parsują całą historię bez izolacji błędu pojedynczego wpisu. Jeden niepoprawny rekord przerywa odczyt. Wyłączenie wysyłki jest bezpieczne, ale retry wycofań również zaczyna od odczytu całej historii, przez co poprawne oczekujące żądania innych rekordów nie są obsługiwane.

**Podstawa:** analiza kodu. Nie twierdzimy, że uszkodzenie localStorage wystąpiło w normalnym użytkowaniu.

**Zmiana:** walidować rekordy niezależnie, wyraźnie pokazywać nieczytelne wpisy i zachować ich zawartość do odzyskania. Poprawne wycofania powinny móc działać dalej. Uszkodzony aktywny rekord nadal nie może autoryzować wysyłki. Nie proponować czyszczenia całych danych witryny jako podstawowej naprawy.

**Gotowe, gdy:** jeden niepoprawny wpis nie blokuje wycofania innej poprawnej zgody/raportu; UI informuje o problemie, nie gubi tokenów i nie aktywuje udostępniania na podstawie niepełnych danych.

### A09 · P2 · Historia 50 raportów diagnostycznych wymaga bezpiecznego cyklu życia

**Miejsce:** `src/lib/diagnostics.ts:65`, `:98`; `src/components/Diagnostics.tsx:43`.

**Ograniczenie i skutek:** limit uwzględnia również raporty wygasłe i takie, których usunięcie potwierdzono. Interfejs pokazuje te stany, lecz nie pozwala archiwizować lokalnych rekordów. Po 50 próbach tworzących wpisy nowe zgłoszenia pozostają zablokowane bez ingerencji w lokalne dane. To świadome zabezpieczenie przed wzrostem historii, które potrzebuje bezpiecznej ścieżki dalszego użytkowania.

**Zmiana:** dodać eksport/archiwizowanie i usuwanie lokalnych wpisów zakończonych, z zachowaniem potrzebnych potwierdzeń. Nie usuwać automatycznie rekordów z oczekującym wycofaniem lub niejednoznacznym wynikiem wysyłki. Samo wygaśnięcie pokazywane według zegara klienta wymaga ostrożniejszej reguły niż potwierdzone usunięcie.

**Gotowe, gdy:** można odzyskać miejsce po zamkniętych zgłoszeniach bez czyszczenia ofert, capture i aktywnych danych potrzebnych do wycofania; test obejmuje 50 zamkniętych rekordów oraz rekord nadal oczekujący.

### A10 · P2 · Uzupełnić dowody jakości na rzeczywistych capture

**Miejsce:** `README.md:127`, `prototypes/vision/README.md:14`, `:43`; `docs/deployment.md:105`.

**Luka i skutek:** dokumentacja uczciwie wskazuje brak walidacji rzeczywistej gry/HDR i brak świeżego dodatniego natywnego holdoutu dla whole-offer readera. Przechodzące testy fixture potwierdzają zachowanie na znanych obrazach, ale nie określają jakości w docelowej grze. Prototyp jest osobny od produkcyjnego parsera i jego wyników nie należy przenosić na działający kolektor.

**Zmiana:** przygotować niewielki opisany korpus rzeczywistych pozytywnych i negatywnych capture: kilka rozdzielczości, skal UI, obsługiwanych proporcji, tryby SDR/HDR, tooltipy i nieznane nazwy. Oddzielić materiał rozwojowy od zamrożonego holdoutu. Uzupełnić istniejącą ręczną bramkę wydania o konkretne środowiska i wyniki, zamiast samego potwierdzenia wykonania testu.

**Gotowe, gdy:** wyniki podają pominięcia, fałszywe rozpoznania, abstencje i poprawność podziału offered/collected/invoked wraz z liczebnością próbek. Produkcyjny parser i prototyp mają oddzielne wyniki. Warunkiem integracji prototypu jest pozytywny wynik na niezależnych próbkach.

### A11 · P3 · Testy AHK i kalibracji są lokalne, ale nie chronią CI

**Miejsce:** `.github/workflows/ci.yml:45`, `scripts/test-helper.mjs:6`; `helpers/tests/Validate-Helper.ahk`, `helpers/tests/Test-Calibration.ahk`.

**Luka:** job Windows sprawdza PowerShell, konwersję obrazu, OCR, upload i diagnostykę, ale nie uruchamia istniejącej walidacji AHK ani testu kalibracji. Lokalne `npm run test:calibration` przeszło podczas audytu.

**Zmiana:** zapewnić określoną wersję AutoHotkey v2 na runnerze i dodać tę komendę do joba Windows. Test WGC wymagający interaktywnego pulpitu utrzymać jako osobną kontrolę wydania; nie utożsamiać testu kompilacji/konwersji pikseli z pełnym przechwytywaniem.

**Gotowe, gdy:** błąd składni helpera i regresja przeliczenia kalibracji zatrzymują CI, a wymagania dla ręcznego testu backendu są jawne.

### A12 · P3 · Koszt skanowania rośnie wraz z historią plików

**Miejsce:** `helpers/CloudUpload.Common.ps1:423`, `:432`, `:452`; `src/lib/capture-sync.ts:22`; `src/lib/useCaptureSync.ts:54`.

**Obserwacja:** helper ponownie enumeruje katalog pod blokadą; limit 32 obejmuje nowo przetwarzane pliki, a nie wszystkie sprawdzenia starych plików. Przeglądarka również enumeruje folder przy kolejnych skanach, mimo cache ID. Limit 250 rekordów lokalnych nie ogranicza liczby plików w folderze. Złożoność pełnego przebiegu rośnie z archiwum; nie zmierzono jeszcze problemu wydajnościowego.

**Zmiana:** najpierw zmierzyć czas, I/O, użycie pamięci i opóźnienie nowego capture dla 1 tys. i 10 tys. plików. Dopiero na tej podstawie rozważyć dziennik/indeks, rotację archiwum lub rzadszą rekonsyliację. Zachować odnajdywanie plików, dla których proces przerwał się przed zapisaniem indeksu.

**Gotowe, gdy:** zapisany benchmark uzasadnia zmianę; po optymalizacji nowy plik dociera z przewidywalnym opóźnieniem, a restart i utrata wpisu indeksu nie gubią capture.

### A13 · P3 · Edytor pozwala wpisać modyfikatory niezgodne ze schematem

**Miejsce:** `src/components/OfferEditor.tsx:33`; `shared/schema.ts:45`; `src/App.tsx:83`.

**Problem:** textarea dopuszcza 12 000 znaków i rozdziela zawartość po nowych liniach, podczas gdy kontrakt dopuszcza najwyżej 40 wpisów po 1000 znaków. Już pojedynczy wiersz 1001 znaków albo 41 krótkich wierszy może zablokować zapis i eksport draftu. Walidacja nie gubi treści, lecz komunikat jest ogólny i odsyła do ścieżki schematu.

**Zmiana:** pokazywać błąd przy polu, wskazywać konkretny za długi wiersz/liczbę wpisów i udostępnić poprawny stan zapisu. Rozdzielić roboczy tekst formularza od poprawnego obiektu domenowego, jeżeli potrzebne jest przechowywanie przejściowo niepoprawnych wartości. Nie ucinać treści bez wiedzy użytkownika.

**Gotowe, gdy:** przypadki 1001 znaków, 41 wierszy i powrotu do poprawnej wartości dają jasny komunikat; autozapis wznawia się po poprawieniu i nie usuwa wpisanego tekstu.

### A14 · P3 · Uprościć zarządzanie sesją edycji w `App.tsx`

**Miejsce:** `src/App.tsx:18`, `:75`, `:120`, `:168`.

**Obserwacja:** główny komponent łączy draft, rewizje, dirty/busy, referencje sesji, autozapis, import, przywracanie, historię i udostępnianie. Mechanizmy ochronne istnieją i część wyścigów ma dobre testy E2E. Dalsze rozbudowywanie tej samej funkcji utrudnia jednak ocenę dopuszczalnych przejść, szczególnie przy zmianie aktywnego draftu w trakcie operacji asynchronicznej.

**Zmiana:** po naprawach A01–A02 wydzielić mały kontroler/hook sesji edycji i zapisu z jawnymi rezultatami operacji. Wykorzystać istniejące moduły storage/importów; nie dodawać z tego powodu nowej biblioteki stanu ani przebudowywać całego UI.

**Gotowe, gdy:** komponent główny przede wszystkim komponuje interfejs, a sterowanie zapisem ma jedno miejsce odpowiedzialności. Dotychczasowe testy konfliktów, retry i pisania podczas autozapisu oraz nowe regresje A01–A02 pozostają zielone.

## Proponowana kolejność

1. **Integralność danych:** A01, A02, A03. Do każdej poprawki dodać test jej scenariusza; obecne zielone testy nie obejmują tych luk.
2. **Odzyskiwanie i backup:** A04, A05, A06, A08. A05 i A06 można realizować razem w module kolejki, zachowując osobne kryteria odbioru.
3. **Przed rozszerzeniem użycia i automatyzacji rozpoznawania:** A07 i A10; równolegle A09 dla długotrwałego użytkowania diagnostyki.
4. **Utrzymanie:** A11 i A13 jako małe zadania; A12 po benchmarku; A14 po ustabilizowaniu napraw zapisu.

## Wykonana walidacja

| Sprawdzenie | Wynik |
| --- | --- |
| `npm run check` | PASS: kontrola typów, testy i build |
| `npm test` na Node 24.14.0 | PASS: 109 testów, 12 plików |
| `npm run test:e2e` na Node 24.14.0 | PASS: build i 36 testów Chromium na lokalnym Workerze/D1 |
| Testy Python w `prototypes/vision/.venv` | PASS: 32 testy |
| `npm run test:helper` | PASS: fixture capture, rzeczywisty lokalny OCR, kontekst sesji i granice walidacji |
| `npm run test:upload` | PASS: konfiguracja, zgody, kolejka, retry, wycofania i istniejące scenariusze uszkodzenia stanu |
| `npm run test:upload:integration` | PASS: helper → lokalny Worker → D1, offline/restart, potwierdzenia, deduplikacja i wycofania |
| `npm run test:diagnostics` | PASS |
| `npm run test:calibration` | PASS |
| `npm run test:ocr` | PASS |
| `npm run test:capture-image` | PASS: konwersja i kompilacja backendu, nie pełny capture gry |
| Cztery dodatkowe próby audytu | Potwierdziły obecne niepożądane zachowanie A01–A04 |

Dodatkowe próby zapisano lokalnie w ignorowanym katalogu `.qa/repo-audit/` (`reproductions.test.ts`, `vitest.config.mjs`). Można je uruchomić przez `npx vitest run --config .qa/repo-audit/vitest.config.mjs`. Ich asercje opisują **obecny błąd**, dlatego wynik PASS oznacza odtworzenie problemu, a nie jego naprawienie. Przy implementacji należy przekształcić je w właściwe regresje oczekujące poprawnego zachowania.

Pierwsze próby E2E, części testów helpera i Pythona zatrzymały ograniczenia sandboxa. Po uruchomieniu lokalnych testów z odpowiednimi uprawnieniami przeszły. Domyślny Node miał wersję 26.13.0; testy jednostkowe powtórzono na wymaganym Node 24.14.0, na którym wykonano również końcowy build/E2E. Tych problemów środowiskowych nie zaliczono do błędów repozytorium.

Nie wykonano rzeczywistego F9 w PoE, `test:capture-backend`, testu nakładki na ekranie, testów produkcji/stagingu ani przeglądu aktualnego stanu usług zdalnych. Nie prowadzono pełnego audytu podatności zależności. Ocena UI opiera się tu na kodzie i istniejących testach przeglądarkowych, w tym wąskich ekranów; nie jest osobnym przeglądem wizualnym wszystkich widoków.

## Rozwiązania, które warto zachować

- Ścisłe schematy i limity danych, brak przesyłania pikseli obrazu w endpointach badawczych.
- Rozdział automatycznego, niesprawdzonego capture od ręcznie sprawdzonych obserwacji.
- Atomowe operacje IndexedDB, kontrola rewizji istniejących ofert i idempotentne potwierdzenia serwera.
- Zachowanie oryginalnego evidence oraz korekt użytkownika przy ponownym imporcie.
- Trwała kolejka, DPAPI, osobne zgody i możliwość wycofania bez klucza kolekcji.
- Testowanie rzeczywistego lokalnego Workera/D1 oraz promocja tego samego zweryfikowanego artefaktu ze stagingu.
- Jawnie opisane ograniczenia rozpoznawania i oddzielenie prototypu od produkcji.

Nie ma podstaw do wymiany React/Vite, dodawania dużego frameworka stanu ani przebudowy architektury jako pierwszego kroku. Największą wartość dadzą teraz punktowe naprawy integralności i odzyskiwania danych.
