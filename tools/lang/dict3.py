# -*- coding: utf-8 -*-
# часть 3: длинные пояснения под настройками
ROWS = [
("(mp4, webm) — видео зациклится само. Ссылка на страницу с картинкой не подойдёт: нужна та, что открывается и показывает саму картинку. Размытие и затемнение снизу действуют и на неё.",
 "(mp4, webm) — відео зациклиться саме. Посилання на сторінку з картинкою не підійде: потрібне те, що відкривається і показує саму картинку. Розмиття й затемнення знизу діють і на неї.",
 "(mp4, webm) — the video loops by itself. A link to a page with a picture won't do: you need the one that opens the picture itself. The blur and dim sliders below apply to it too."),

(", контрольная сумма сверяется с опубликованной там же — на диск файл ложится, только если она сошлась. Без него не работают ни поиск по YouTube, ни скачивание, ни плейлисты по ссылке.",
 ", контрольна сума звіряється з опублікованою там само — на диск файл лягає, тільки якщо вона зійшлася. Без нього не працюють ні пошук на YouTube, ні завантаження, ні плейлисти за посиланням.",
 ", and the checksum is compared with the one published alongside it — the file only lands on disk if they match. Without it, YouTube search, downloads and playlists by link don't work."),

("Deezer и iTunes: название, артист, альбом, обложка и отрывок на 30 секунд. Рядом с каждым треком — кнопки, чтобы открыть его в Яндексе, VK или на YouTube.",
 "Deezer та iTunes: назва, виконавець, альбом, обкладинка й уривок на 30 секунд. Поруч із кожним треком — кнопки, щоб відкрити його в Яндексі, VK чи на YouTube.",
 "Deezer and iTunes: title, artist, album, artwork and a 30-second preview. Next to every track are buttons to open it in Yandex, VK or YouTube."),

("Spotify, Яндекс Музыка, браузер, AIMP, Telegram — всё, что умеет показывать трек в панели громкости Windows",
 "Spotify, Яндекс Музика, браузер, AIMP, Telegram — усе, що вміє показувати трек у панелі гучності Windows",
 "Spotify, Yandex Music, a browser, AIMP, Telegram — anything that can show a track in the Windows volume flyout"),

("YouTube отдаёт только тем, кто вошёл в аккаунт. Если выбрать браузер, yt-dlp возьмёт из него куки и покажет ютубу, что ты залогинен. Куки читаются на этом компьютере и уходят только на сам YouTube — больше никуда. Браузер при этом лучше закрыть, иначе он держит свою базу занятой.",
 "YouTube віддає лише тим, хто увійшов в акаунт. Якщо вибрати браузер, yt-dlp візьме з нього куки й покаже ютубу, що ти залогінений. Куки читаються на цьому комп'ютері й ідуть тільки на сам YouTube — більше нікуди. Браузер при цьому краще закрити, інакше він тримає свою базу зайнятою.",
 "YouTube only serves those who are signed in. Pick a browser and yt-dlp will take its cookies and show YouTube that you're logged in. The cookies are read on this computer and go to YouTube alone — nowhere else. Best to close the browser first, otherwise it keeps its database locked."),

("«Насыщенность» стоит убавить, если визуализация спорит с текстом песни: форма останется, но перестанет лезть на первый план.",
 "«Насиченість» варто зменшити, якщо візуалізація сперечається з текстом пісні: форма лишиться, але перестане лізти на перший план.",
 "Turn the opacity down if the visualisation fights the lyrics: the shape stays, but stops pushing to the front."),

("«Подобрать теги» найдёт в каталоге треки, у которых не хватает артиста или альбома, и проставит их вместе с обложкой. Сами файлы не меняются — правки живут только в библиотеке приложения.",
 "«Підібрати теги» знайде в каталозі треки, яким бракує виконавця чи альбому, і проставить їх разом з обкладинкою. Самі файли не змінюються — правки живуть лише в бібліотеці застосунку.",
 "“Fill in tags” looks up tracks missing an artist or album in the catalogue and fills them in along with the artwork. The files themselves aren't touched — the edits live only in the app's library."),

("В папке с данными лежат настройки, библиотека, обложки и кэш текстов. Удалишь её — приложение забудет всё, кроме самих музыкальных файлов.",
 "У теці з даними лежать налаштування, бібліотека, обкладинки й кеш текстів. Видалиш її — застосунок забуде все, крім самих музичних файлів.",
 "The data folder holds your settings, library, artwork and the lyrics cache. Delete it and the app forgets everything except the music files themselves."),

("В файл попадают названия, артисты и пути к трекам — сама музыка остаётся на диске. Ключи и токены в бэкап не записываются.",
 "У файл потрапляють назви, виконавці й шляхи до треків — сама музика лишається на диску. Ключі й токени в копію не записуються.",
 "The file holds titles, artists and paths to the tracks — the music itself stays on disk. Keys and tokens are never written into a backup."),

("Вся библиотека, плейлисты, избранное и настройки складываются в один файл. Его можно унести на другой компьютер, положить в облако или просто держать на случай, если что-то сломается. Это и есть синхронизация — без аккаунтов и паролей.",
 "Уся бібліотека, плейлисти, обране й налаштування складаються в один файл. Його можна віднести на інший комп'ютер, покласти в хмару або просто тримати на випадок, якщо щось зламається. Це і є синхронізація — без акаунтів і паролів.",
 "Your whole library, playlists, favourites and settings go into a single file. Carry it to another computer, put it in the cloud, or just keep it in case something breaks. That's the sync — with no accounts and no passwords."),

("Выбранный файл копируется в папку приложения — если потом удалишь оригинал, картинка останется. Ссылка годится только",
 "Вибраний файл копіюється в теку застосунку — якщо потім видалиш оригінал, картинка лишиться. Посилання годиться лише",
 "The chosen file is copied into the app's folder — delete the original later and the picture stays. A link only works if it's"),

("Если в файле обложки нет, приложение поищет её по артисту и названию. Треки при этом никуда не отправляются — только текстовый запрос.",
 "Якщо у файлі обкладинки немає, застосунок пошукає її за виконавцем і назвою. Треки при цьому нікуди не надсилаються — лише текстовий запит.",
 "If the file has no artwork, the app looks it up by artist and title. The tracks themselves go nowhere — only a text query does."),

("Кадр собирается заново, а не снимается с экрана: ни рамки окна, ни боковой панели. Берётся обложка, цвет из неё, спектр и строка текста с той же заливкой, что и в караоке.",
 "Кадр збирається заново, а не знімається з екрана: ні рамки вікна, ні бічної панелі. Береться обкладинка, колір із неї, спектр і рядок тексту з тією ж заливкою, що й у караоке.",
 "The frame is built from scratch rather than grabbed off the screen: no window chrome, no sidebar. It takes the artwork, its colour, the spectrum and a lyric line with the same fill as karaoke."),

("Кидай в эту папку любые mp4 или webm — плеер перемешает их и будет крутить по кругу, плавно переключая.",
 "Кидай у цю теку будь-які mp4 чи webm — плеєр перемішає їх і крутитиме по колу, плавно перемикаючи.",
 "Drop any mp4 or webm into this folder — the player shuffles them and loops through, fading between them."),

("Когда у нас ничего не заряжено, нажатие уходит дальше — в Spotify или браузер.",
 "Коли в нас нічого не заряджено, натискання йде далі — у Spotify або браузер.",
 "When we have nothing loaded, the keypress passes on — to Spotify or the browser."),

("На таких треках не работают эквалайзер и визуализация — звук идёт внутри чужого плеера, и мы его не слышим. Текст песни при этом подхватывается.",
 "На таких треках не працюють еквалайзер і візуалізація — звук іде всередині чужого плеєра, і ми його не чуємо. Текст пісні при цьому підхоплюється.",
 "The equaliser and the visualisation don't work on these tracks — the sound plays inside someone else's player and we can't hear it. The lyrics are still picked up."),

("Новая версия приходит с той же страницы релизов, откуда ты скачал плеер. Сама она ничего не скачивает и не ставит — сначала спросит. В сеть при проверке уходит только номер твоей версии.",
 "Нова версія приходить з тієї самої сторінки релізів, звідки ти завантажив плеєр. Сама вона нічого не завантажує і не ставить — спершу запитає. У мережу під час перевірки йде лише номер твоєї версії.",
 "A new version comes from the same releases page you downloaded the player from. It never downloads or installs anything on its own — it asks first. All that goes out during a check is your version number."),

("Перекрас уводит в выбранный цвет весь интерфейс: панели, рамки, подложки и фон. Если цвет берётся из обложки, приложение будет менять оттенок вместе с треком.",
 "Перефарбування веде у вибраний колір увесь інтерфейс: панелі, рамки, підкладки й фон. Якщо колір береться з обкладинки, застосунок змінюватиме відтінок разом із треком.",
 "The tint pulls the whole interface toward the chosen colour: panels, borders, backdrops and the background. If the colour comes from the artwork, the app will change its hue along with the track."),

("Плеер не заводит аккаунтов, не собирает статистику и не следит за тобой. Музыка, настройки и обложки лежат на этом компьютере. В сеть уходят только текстовые запросы — артист и название, — чтобы найти текст песни и обложку.",
 "Плеєр не заводить акаунтів, не збирає статистику й не стежить за тобою. Музика, налаштування й обкладинки лежать на цьому комп'ютері. У мережу йдуть лише текстові запити — виконавець і назва, — щоб знайти текст пісні та обкладинку.",
 "The player creates no accounts, collects no analytics and doesn't watch you. Your music, settings and artwork stay on this computer. All that leaves are text queries — artist and title — to find lyrics and artwork."),

("Плеер с караоке: строка подсвечивается ровно по мере того, как её поют. Начнём с главного — откуда берём музыку?",
 "Плеєр із караоке: рядок підсвічується рівно в міру того, як його співають. Почнімо з головного — звідки беремо музику?",
 "A player with karaoke: the line lights up exactly as it's sung. First things first — where does the music come from?"),

("Плеер умеет проигрывать треки с YouTube и SoundCloud через их официальные встроенные плееры — целиком, с их серверов, ничего не скачивая. Вставь ссылку на трек в строку поиска, и он заиграет.",
 "Плеєр уміє програвати треки з YouTube і SoundCloud через їхні офіційні вбудовані плеєри — цілком, з їхніх серверів, нічого не завантажуючи. Встав посилання на трек у рядок пошуку, і він заграє.",
 "The player can play tracks from YouTube and SoundCloud through their own official embedded players — in full, from their servers, downloading nothing. Paste a track link into the search box and it plays."),

("Последние полминуты громкость плавно уходит в ноль, чтобы не обрывало на полуслове.",
 "Останні півхвилини гучність плавно йде в нуль, щоб не обривало на півслові.",
 "Over the last half-minute the volume slides to zero, so nothing is cut off mid-word."),

("Профиль запоминает всё оформление разом: тему, шрифты, цвет, визуализацию с её настройками, раскладку, обложку и фон. Настроил под себя — сохрани, и можно переключаться одним нажатием. Нажми на имя, чтобы переименовать.",
 "Профіль запам'ятовує все оформлення разом: тему, шрифти, колір, візуалізацію з її налаштуваннями, розкладку, обкладинку й фон. Налаштував під себе — збережи, і можна перемикатися одним натисканням. Натисни на ім'я, щоб перейменувати.",
 "A profile remembers the whole look at once: theme, fonts, colour, the visualisation with its settings, layout, artwork and background. Set it up the way you like, save it, and switch with one click. Click the name to rename it."),

("Размер и начертание действуют на весь интерфейс, кроме текста песни — у него свои настройки в «Настройках».",
 "Розмір і накреслення діють на весь інтерфейс, крім тексту пісні — у нього свої налаштування в «Налаштуваннях».",
 "Size and weight apply to the whole interface except the lyrics — those have their own settings under Settings."),

("Скачанные треки складываются сюда и сразу попадают в библиотеку. Артист, альбом и обложка подбираются по каталогу автоматически. Можно отметить галочками сразу несколько треков в поиске — они встанут в очередь.",
 "Завантажені треки складаються сюди й одразу потрапляють до бібліотеки. Виконавець, альбом і обкладинка підбираються за каталогом автоматично. Можна позначити галочками одразу кілька треків у пошуку — вони стануть у чергу.",
 "Downloaded tracks land here and go straight into the library. Artist, album and artwork are matched from the catalogue automatically. Tick several tracks at once in search and they'll queue up."),

("Следующий трек начинается, пока текущий ещё звучит, — тишины между песнями не остаётся. Выравнивание слушает, насколько трек громкий, и подводит его к общему уровню; правка ограничена вдвое в обе стороны, так что тихие места останутся тихими. И то и другое работает со своих файлов: у YouTube и SoundCloud звук идёт внутри их плеера, туда нам хода нет.",
 "Наступний трек починається, поки поточний ще звучить, — тиші між піснями не лишається. Вирівнювання слухає, наскільки трек гучний, і підводить його до спільного рівня; правка обмежена вдвічі в обидва боки, тож тихі місця лишаться тихими. І те й інше працює зі своїх файлів: у YouTube і SoundCloud звук іде всередині їхнього плеєра, туди нам ходу немає.",
 "The next track starts while the current one is still playing, so no silence is left between songs. Levelling listens to how loud a track is and brings it toward a common level; the correction is capped at twice in either direction, so quiet passages stay quiet. Both work with your own files: on YouTube and SoundCloud the sound plays inside their player, where we have no reach."),

("Считается на этом компьютере и никуда не уходит. Нужно «Моей волне», чтобы отличать привычное от забытого, и титулам, которые зарабатываются.",
 "Рахується на цьому комп'ютері й нікуди не йде. Потрібно «Моїй хвилі», щоб відрізняти звичне від забутого, і титулам, які заробляються.",
 "Counted on this computer and going nowhere. My Wave needs it to tell the familiar from the forgotten, and so do the titles you earn."),

("То же самое переключается кнопкой в углу вкладки «Сейчас играет» или клавишей",
 "Те саме перемикається кнопкою в кутку вкладки «Зараз грає» або клавішею",
 "The same thing switches with the button in the corner of the Now Playing tab, or the key"),

("Тяни полосы мышкой или колесом. Двойной клик по полосе — обнулить её.",
 "Тягни смуги мишкою або колесом. Подвійний клік по смузі — обнулити її.",
 "Drag the bands with the mouse or the wheel. Double-click a band to zero it."),

("и вставь сюда. Название приложения — это то, что увидят друзья после слова «Слушает».",
 "і встав сюди. Назва застосунку — це те, що побачать друзі після слова «Слухає».",
 "and paste it here. The application name is what your friends will see after the word “Listening to”."),
]
