# Fate Advisor — reguły Covens of Umbra z prezentacji i Q&A

Stan: **8 listopada 2026**, po sprawdzeniu oryginalnego Q&A oraz pokazu DatModz i Octaviana. Materiał przedpremierowy, bez własnych testów mechaniki w grze. Nazwa pliku zachowuje datę pierwszego rozpoznania.

## Wynik i zakres weryfikacji

7 listopada odczytano automatyczne angielskie napisy całej prezentacji PoE1 w [oficjalnej transmisji GGG — dzień 1](https://www.youtube.com/watch?v=8FKW2rKJyxA), około 03:08:45–03:35:25. Fragment o Fate'ach dodatkowo sprawdzono na klatkach filmu, w tym tooltipy i animację łączenia duplikatów.

8 listopada zweryfikowano doprecyzowania z [oryginalnego panelu PoE1 Q&A — dzień 2](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11220s), w szczególności około **03:07:06–03:10:07**. Źródłem były angielskie napisy automatyczne pobrane bezpośrednio z transmisji kanału Path of Exile. Pobrano zakres obejmujący panel i wyszukano wypowiedzi o kartach, łączeniu, nagrodach oraz rarity; odczytano cały fragment o Fates wraz z kontekstem. Odtworzono też wybrane momenty w odtwarzaczu YouTube i porównano wyświetlane napisy oraz czas z pobranymi segmentami. Klatka obrazu potwierdziła, że jest to panel rozmówców, a nie demonstracja łączenia kart w grze.

To bezpośrednia weryfikacja treści napisów oficjalnego nagrania, **nie niezależna transkrypcja ze słuchu ani test działania gry**. ASR zawiera błędy, zwłaszcza w nazwach; zapisuje m.in. Fated jako „faded”. Pisowni tej etykiety nie potwierdzono na tooltipie w Q&A; potwierdzono ją później na obrazie pokazu DatModz. Czasy odnoszą się do całej transmisji; linki zaczynają się kilka sekund przed wypowiedzią. Zakres i identyfikatory segmentów zapisano w [metryce weryfikacji](evidence/qa-2026-11-08-verification.json).

Następnie sprawdzono [pokaz DatModz i Octaviana w dniu 1](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=25200s). Ponieważ zapis nie udostępniał już napisów YouTube, wykonano lokalną transkrypcję dźwięku **07:00:00–07:27:00** przy użyciu whisper.cpp 1.9.2 / base.en i odczytano ją w całości. Wybór oraz przywoływanie Fates porównano z klatkami nagrania, a sekwencję scalania dodatkowo sprawdzono co sekundę. To automatyczna transkrypcja i analiza obrazu, bez niezależnej korekty ze słuchu. [Metryka pokazu i zapisane klatki](evidence/showcase-2026-11-08-verification.json).

Początkowy błąd odtwarzacza z pierwszego rozpoznania udało się rozwiązać przez odczyt publicznych napisów i segmentów transmisji. Materiały prasowe i późniejsza relacja społecznościowa służyły do odnalezienia szczegółów; poniższe ustalenia z Q&A sprawdzono już w źródle pierwotnym.

## Potwierdzone reguły

- Zwykłe Fates pozostają w instancji, w której zostały zebrane. Pokaz mówi o zbieraniu nawet czterech–pięciu kart w obszarze i przywoływaniu maksymalnie trzech. Cztery–pięć nie zostało przedstawione jako bezwzględny limit. Każda karta ma przynajmniej jedną zwykłą nagrodę; może mieć też combo. [Fragment](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11590s).
- Combo wymaga odpowiedniej liczby kopii **tej samej ikony nagrody**, a nie stałego zestawu nazw Fate'ów. [Fragment](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11620s).

| Combo | Wymaganie | Efekt | Dowód |
| --- | --- | --- | --- |
| Item Rarity | 3 kopie właściwej ikony | Bardzo duże zwiększenie Item Rarity bossa; bez podanej liczby | [03:13:50](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11630s), evidence/item-rarity-03h13m57.png |
| Exceptional Gem | 3 kopie właściwej ikony | Dodatkowy Exceptional Gem; prowadzący określa go jako exceptional support | [03:14:30](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11670s), evidence/exceptional-tooltip-03h14m37.png |
| Dreadmaidens' Sacrament | 2 kopie właściwej ikony | Konkretny unique Basalt Flask | [03:14:45](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11685s), evidence/flask-tooltip-03h14m57.png |

Pokazane Bloodthirsty + Sanguine + Deathbringer uruchamiają Exceptional Gem. To przykład konkretnych kart z pasującymi ikonami, nie uniwersalna receptura na te trzy nazwy. Wildfire pokazano z ikoną flaska.

## Duplikaty: wypowiedź i obserwacja interfejsu

GGG zapowiada potrojenie nagród **pierwszego zagranego Fate'a** po połączeniu kopii tego samego typu. [Prezentacja](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11700s). W późniejszym Q&A pada wprost, że **nagrody drugiej karty są odrzucane**, a karty można wycofać i zagrać ponownie w innej kolejności. Nie chodzi o potrojenie sumy nagród obu kart. [Q&A, od 03:09:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11385s).

Sekwencja dwóch Conjurerów pokazuje dodatkowo:

- z dwóch kart powstaje jedna karta w pierwszym slocie;
- dwie zwykłe ikony pierwszej karty pojawiają się po trzy razy;
- osobna ikona drugiej karty nie pojawia się w wyniku;
- aktywuje się ikona combo currency, a po prawej pozostaje wyszarzona kopia;
- karta po połączeniu ma więcej piór oznaczających tier.

Dowody: evidence/duplicates-before-03h15m02.png, evidence/duplicates-after-03h15m03.png, evidence/duplicates-sequence-03h15m00.png.

To potwierdza interakcję duplikatu z combo w pokazanym przykładzie. Interpretacja „potrojenie licznika combo, następnie rozliczenie progu” pasuje do obrazu, ale nie jest jeszcze zweryfikowaną ogólną regułą wszystkich combo. Nie należy automatycznie implementować jej dla każdej nagrody.

Tooltip piór potwierdza, że wyższy tier zwiększa Item Rarity i może wzmacniać niebezpieczne efekty. Dowód: evidence/fate-tier-03h15m02.png.

## Doprecyzowania z Q&A — zweryfikowane 8 listopada

| Ustalenie | Treść wypowiedzi i granica wniosku | Źródło w dniu 2 |
| --- | --- | --- |
| Nagrody nie są na stałe przypisane do nazwy Fate'a | Nagrody losują się niezależnie od typu karty; Rot jest przykładem karty, która nie musi zawsze dawać currency. Nie ustala to równych szans wszystkich nagród ani niezależności poszczególnych ikon od siebie. | [03:07:30](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11250s), wypowiedź ok. 03:07:36–03:07:56 |
| Efekt ikony może objąć także pozostały łup bossa | Przykład: efekt zapewniający mod szybkości na wszystkich butach upuszczanych przez wzmocnionego potwora gwarantuje również kilka par butów. Obejmuje też inne buty, które ten potwór i tak by upuścił. Nie wolno sprowadzać tego do jednej dodatkowej sztuki przedmiotu. | [03:07:50](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11270s), wypowiedź ok. 03:07:56–03:08:11 |
| Przedmioty zmodyfikowane przez efekt mają etykietę Fated | Etykieta odróżnia je przy dropie, podobnie jak Superior oznacza jakość. Q&A opisuje jej działanie; pisownię potwierdza późniejsza kontrola obrazu z pokazu DatModz, opisana niżej. | [03:08:05](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11285s), wypowiedź ok. 03:08:11–03:08:21 |
| Gwarantowany mod ma być wartościowy | Wyjaśnienie na przykładzie fizycznego moda wskazuje, że jest on wysokiego tieru. Nie podano konkretnego tieru, wartości, listy modów ani obietnicy T1 na każdym przedmiocie. | [03:08:20](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11300s), wypowiedź ok. 03:08:21–03:08:46 |
| Rarity bossa wpływa również na przedmioty z szablonów nagród | Szablony przedmiotów mogą być modyfikowane przez rarity przypisanego potwora. W omawianym przykładzie także sam przedmiot może częściej mieć wyższy tier. To częściowo rozstrzyga wcześniejsze pytanie o wymuszone nagrody; nie ustala wpływu rarity na każde combo, currency, Exceptional Gems czy konkretny unique. | [03:08:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11325s), wypowiedź ok. 03:08:46–03:09:06 |
| Dwie karty tieru 2 mogą dać tier 3 | W kontekście duplikatów i przykładu dwóch Rot pada wyjaśnienie, że w endgame są wersje tieru 2 i 3, a tier 3 otrzymuje się przez połączenie dwóch kart tieru 2. Nie jest to dowód reguły dla dwóch dowolnych nazw, mieszanych tierów ani kolejnego scalania z kartą tieru 3. | [03:09:30](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11370s), wypowiedź ok. 03:09:36–03:09:51 |
| Kolejność duplikatów wybiera zachowane nagrody | Pierwsza karta: nagrody ×3. Druga karta: jej nagrody odpadają. Można wycofać karty i zmienić kolejność przed rozpoczęciem walki. Potwierdza to wcześniejszą obserwację animacji Conjurerów, ale nie ujawnia pełnego algorytmu combo. | [03:09:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11385s), wypowiedź ok. 03:09:51–03:10:07 |

**Trzy odrębne znaczenia tieru:** tier karty Fate, tier upuszczonego przedmiotu i tier jego konkretnego moda. Q&A rozróżnia je w tej samej rozmowie; nie należy przenosić numeracji ani zasad skalowania z jednego na drugi.

## Pokaz DatModz i Octaviana — trzy sprawdzone pytania

Przed przywołaniem gracz ma **Torchbearer T2 + Torchbearer T2 + Tempest T2**. Po zagraniu dwóch Torchbearerów pierwsza karta ma trzy pióra (T3), a środkowy slot zostaje zakryty czarnymi piórami. Następnie Tempest trafia do prawego slotu; gracz zatwierdza zestaw. Sekwencja przypada około **07:24:51–07:25:08**. [Nagranie od 07:24:50](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26690s).

| Pytanie | Co rzeczywiście pokazano | Wniosek |
| --- | --- | --- |
| Trzeci duplikat | Są tylko dwa Torchbearery. Około 07:24:57–07:25:01 Octavian zachęca do zagrania trzeciej karty dla jej podstawowych nagród; na ekranie jest to **Tempest**. | „Trzecia karta” nie oznacza trzeciej kopii Torchbearera. Dalsze scalanie i kolejny mnożnik pozostają nieustalone. |
| Mieszane tiery | Scalane Torchbearery mają po dwa pióra. Wynik ma trzy; pozostały Tempest nadal dwa. | Potwierdzony jest zestaw wynikowy **Torchbearer T3 + Tempest T2**, ale nie scalanie tej samej nazwy o różnych tierach. |
| Limit kart po scaleniu | Użyto trzech kart wejściowych, otrzymując dwie aktywne karty. Środkowy slot pozostaje zakryty również po dodaniu Tempesta, aż do zatwierdzenia. Nie ma czwartej karty ani próby jej zagrania. | Scalenie nie blokuje dodania trzeciej karty wejściowej. Obraz **nie potwierdza odzyskania slotu** i sugeruje zachowanie kosztu dwóch wejść; twardy limit po scaleniu nadal nie jest rozstrzygnięty. |

Klatki porównawcze: [trzy karty przed zagraniem, ok. 07:24:51](evidence/showcase-before-07h24m51.png), [po scaleniu pary, ok. 07:24:55](evidence/showcase-merged-07h24m55.png), [po dodaniu Tempesta, ok. 07:25:00](evidence/showcase-third-card-07h25m00.png). Nie należy już opisywać miejsca po drugiej karcie jako potwierdzonego wolnego slotu.

Pokaz ponownie potwierdza znaczenie kolejności: około 07:23:55–07:24:09 i 07:24:50–07:24:56 Octavian mówi o potrojeniu nagród pierwszego Torchbearera. Nie przedstawia reguły trzech duplikatów ani tabeli mieszanych tierów. [Pierwsze objaśnienie](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26635s).

Dodatkowo [tooltip z ok. 07:25:55](evidence/showcase-fated-07h25m55.png) jednoznacznie pokazuje pisownię **Fated Apex Rapier**. Widoczne na nim „Tier 3” dotyczy przedmiotu, nie karty Fate. [Fragment łupu](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26735s).

## Konsekwencje dla Fate Advisor — propozycja projektu

Warto zbudować doradcę wyboru w obrębie obszaru. Dane pojedynczej karty powinny zawierać typ, tier, zwykłe nagrody oraz ikony combo z progami. Nazwa nie wystarcza.

Doradca powinien porównywać kolejność zagrań, pokazywać aktywowane combo i wyjaśniać, dlaczego korzystniejsza kopia powinna zostać przywołana jako pierwsza. Potrzebne jest porównanie stanu przed i po połączeniu; samo policzenie ikon w początkowym zestawie może dawać błędny wynik.

Q&A uzasadnia zachowanie osobnych danych o tierze karty, efektach nagród i wynikowym łupie. Opis nagrody powinien pozwalać rozróżnić dodatkowe przedmioty od efektu obejmującego wszystkie przedmioty danego typu z bossa. Przy duplikatach trzeba zachować informację, które nagrody należały do pierwszej, a które do drugiej karty; samo sumowanie zestawu traci tę różnicę. Przejście dwóch zgodnych kart T2 do T3 można odnotować jako zapowiedzianą regułę, bez ekstrapolowania jej na nieopisane połączenia.

Pokaz DatModz uzasadnia osobne liczenie **kart wejściowych** i **kart po scaleniu**: trzy wejścia dają tu dwie aktywne karty. Nie należy z liczby kart wynikowych wyprowadzać pozwolenia na czwarte wejście. Mieszane tiery w zestawie wynikowym nie potwierdzają możliwości ich dalszego scalania.

Nie należy jeszcze obiecywać optymalizacji zysku w divine/hour. Pierwsza wersja może rekomendować warianty pod cel gracza: wybrany przedmiot, kategoria nagrody albo ograniczenie trudności. Reguły niezweryfikowane powinny zwracać „nieustalone”, zamiast udawać brak synergii.

## Nadal nieustalone

1. Pełny katalog ikon, progów i nagród oraz ich częstości.
2. Czy trzeci duplikat ponownie mnoży nagrody, co dzieje się przy próbie dalszego łączenia karty T3 i jak łączą się różne tiery. Q&A opisuje endgame'owe T2/T3 i przejście T2 + T2 do T3. Pokaz DatModz zawiera tylko parę T2 + T2 i inną kartę T2, więc nie rozstrzyga pozostałych kombinacji.
3. Czy po scaleniu można wykorzystać więcej niż trzy karty wejściowe. Pokaz DatModz potwierdza trzy wejścia i dwie karty wynikowe, ale miejsce po drugiej karcie jest zakryte piórami, a nie widocznie wolne. Hipoteza zachowania kosztu wejść jest zgodna z obrazem; nie przeprowadzono próby czwartego wejścia.
4. Pełny algorytm oddziaływania duplikatów na combo, wielokrotne wypłaty i pozostałe kopie ikon.
5. Dokładne ilości nagród, pula Exceptional Gems i zależności od poziomu obszaru.
6. Dokładny wpływ rarity na każdą kategorię wymuszonych nagród, jej ilość i combo. Q&A potwierdza wpływ rarity potwora na szablony przedmiotów i ich tier, ale nie podaje wzorów, szans ani uniwersalnego mnożnika wszystkich nagród.
7. Dokładny katalog efektów Fated, liczby gwarantowanych przedmiotów, pule i tiery ich modów oraz wpływ poziomu obszaru. Przykład kilku par butów nie daje konkretnej liczby ani stałego tieru moda.

## Źródła uzupełniające

- [Oficjalna strona ligi](https://www.pathofexile.com/covens).
- [Pakiet prasowy GGG](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip): wcześniej odczytano m.in. Fates_UI.png, Fates_UI_2.png, InvokeFates_1.png, InvokeFates_2.png. Potwierdzają różne zestawy ikon przy tej samej nazwie Fate'a.
- [Relacja Output Lag](https://outputlag.com/news/path-of-exile-3-30-covens-of-umbra-invoke-fate-cards-on-area-bosses-for-bigger-loot/) pomogła odnaleźć nagranie. Główne ustalenia powyżej sprawdzono już bezpośrednio w materiale GGG.
- [Relacja Karui Polska z Q&A](https://karuipolska.pl/newsy/exilecon-2026-developer-panel-path-of-exile-1-q-a) wskazała doprecyzowania do sprawdzenia. Nie stanowi podstawy statusu „zweryfikowane” — jest nią oryginalna transmisja dnia 2 i jej napisy.

Aktualizacja z 8 listopada obejmuje ustalenia badawcze. Nie zmieniano kodu aplikacji, nie publikowano zmian ani nie wykonywano testów mechaniki w grze.
