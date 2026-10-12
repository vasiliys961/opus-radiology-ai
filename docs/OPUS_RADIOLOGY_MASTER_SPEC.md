# OPUS RADIOLOGY AI — ЕДИНЫЙ ПАСПОРТ КОНЕЧНОГО ПРОДУКТА
**Living specification / Source of Truth · версия 2.0, 2026-10-11**

> **Правило для новых чатов, Cursor и всех AI-разработчиков:** считать этот файл общей целью проекта, а не заявлением, что все перечисленные возможности уже готовы. Сначала сверить \`main\` GitHub, CI, реальные исходники и раздел «Фактическое состояние», затем продолжить разработку следующего неполного этапа. Никаких имитаций диагностики, выдуманных моделей, неподтверждённых измерений или «зелёных» статусов без запуска проверок.

**Репозиторий:** https://github.com/vasiliys961/opus-radiology-ai  
**Главное приложение:** \`web/\` — Next.js + React + Cornerstone3D.  
**Локальная рабочая копия пользователя:** \`~/Desktop/opus-radiology-ai-github\`.  
**Развёртывание:** веб-приложение в браузере; опциональный локальный AI-воркер на Mac/Windows/Linux; такой же контракт на CPU/GPU-сервере.  
**Конечный пользователь:** врач/рентгенолог или исследователь, которому нужен контролируемый анализ КТ, МРТ, а далее рентгенографии и дополнительных модальностей с просмотром доказательств.  
**Приоритет:** максимум реального качества при ограничении памяти/стоимости, воспроизводимой обработке и гарантированной защите пациента.

---

## 1. Неизменяемая цель продукта

Создать **универсальную расширяемую браузерную рабочую станцию КТ/МРТ с гибридным AI**. Врач открывает исследование DICOM в браузере, получает полноценные 2D/MPR/3D, техническую проверку всех серий, результаты специализированных нейросетей (сегментация, детекция кандидатов, измерения) и независимую интерпретацию VLM/LLM. Система сводит результаты в пространственно проверяемый Evidence Engine, показывает неопределённость, отклонения и границы покрытия, формирует **черновик для врачебного подтверждения**, но не выдаёт недоказанную уверенность или неподдерживаемые диагнозы.

**Не подменять** медицинскую задачу одинокой LLM, несколькими JPEG, универсальным одним чекпойнтом, фальшивыми результатами или «голосованием» агентов. Качественная система — это комбинация полной серии, task-specific models, доказательств, контроля протокола и человеческого review.

Две обязательные оси:
1. **Работа в браузере с опциональной вычислительной средой.** Открытый сайт работает как просмотрщик; компактные модели могут работать в WebAssembly. При доступном локальном воркере включаются установленные локальные медицинские модели. На CPU/GPU-сервере используется тот же API/формат результатов. Браузерное отображение не требует GPU-сервера.
2. **Независимость от подписок и страны провайдера.** Основная функциональность, локальное хранение, визуализация, рабочий план AI, алгоритмы и модели с проверенными разрешениями должны запускаться без обязательного OpenRouter, Gemini, Claude, Hugging Face Inference Endpoint или платного API. Облачные сервисы **опциональны** и включаются только при фактической доступности, бюджетных ограничениях и разрешённой обработке данных. Открытый код проекта не означает автоматически открытую лицензию каждого набора весов.

---

## 2. Четыре вычислительных режима: единый интерфейс и честная деградация

| Режим | Где исполняется inference | Что должен уметь финальный продукт | Ограничения |
|---|---|---|---|
| **A. Browser-only / lightweight** | WebAssembly, при подтверждённой поддержке WebGPU | DICOM-индекс, 2D/MPR/3D по лимитам, локальные измерения, небольшие ONNX 2D-модели, просмотр Evidence | Без Python; не обещать большие 3D сети; при открытии удалённого сайта загрузка JS отличается от полностью offline |
| **B. Local AI Worker (Mac/Win/Linux)** | отдельный Python worker на \`127.0.0.1\`: ONNX Runtime CPU, PyTorch CPU/MPS, MONAI | Загруженные серии → потоковая обработка, поддерживаемые модели локально, маски/координаты/метрики обратно в тот же браузер | На Mac M1 8GB: ограничение параллелизма, ROI, поэтапные тайлы, ранний отказ если памяти мало |
| **C. Private CPU server** | Python inference worker в частной инфраструктуре, без GPU | задачи, совместимые с CPU; масштабирование RAM/ядер, опционально общая очередь | Не гарантировать быструю тяжёлую 3D сегментацию; частный сервер всё равно считается передачей данных |
| **D. Private GPU server** | изолированный worker PyTorch CUDA/ONNX GPU на 12–24/48+ ГБ VRAM | тяжёлые 3D nnU-Net/MONAI/TotalSegmentator, детекторы, ограниченные foundation models, партии заданий | Требуются оплачиваемые вычисления/оборудование; режим для реальных пациентов только после разрешения и защиты |

**Режим AUTO** выбирает только реально доступный и разрешённый маршрут по способностям железа, протоколу, весам, памяти, лицензии и настройкам конфиденциальности. При недоступности модели выдаёт \`unsupported\` с объяснением, **не** подставляет LLM или другую модель как равноценную замену.

**Важная граница:** \`localhost\` в Safari — это браузер + локальный Next.js, а не «все модели работают в браузере». Python/PyTorch требует локального процесса. Размещение Next.js на Vercel/обычном веб-хостинге не создаёт GPU-воркер автоматически.

**Планируемый интерфейс:** статус трёх движков «браузер / локальный / сервер», выбор «только локально / разрешённый частный сервер / опциональные LLM», паспорт ресурсов, модель и источник весов, прогресс, отмена, журналы без PHI, цена/оценка, метки качества, возможность полной работы без внешних LLM.

---

## 3. Покрытие анатомических областей: максимум, но без ложной универсальности

Поддержка **большинства локализаций** означает покрытие по библиотеке специализированных моделей, а **не** утверждение, что каждая патология любого органа одинаково распознаётся. Каждый маршрут имеет \`supported\` / \`partially-supported\` / \`not-supported\` на уровне **модальность × область × протокол × задача × модель × версия**.

| Направление | Базовые задачи | Исследовательские кандидаты / обязательные ограничения |
|---|---|---|
| **КТ грудной клетки** | лёгкие и доли, плевра, медиастинум, крупные сосуды, измерения; обнаружение кандидатов на узлы | Lungmask R231, TotalSegmentator, MONAI Lung Nodule; различать сегментацию и детекцию, оценивать FROC |
| **КТ живота/таза** | печень, почки, селезёнка, поджелудочная, кишечник, сосуды и костные структуры; локальные очаги по отдельным моделям | TotalSegmentator, MONAI model bundles, nnU-Net; учитывать фазы контрастирования |
| **КТ головы** | головной мозг, желудочки, кости; специальные модели для кровоизлияния/ишемии/сосудов при наличии валидированных весов | Не выдавать отрицательный скрининг инсульта по анатомической маске; требуются самостоятельные task-specific модели |
| **МРТ головного мозга** | анатомия и выбранные патологии; опухолевые области при совместимых последовательностях | BraTS/nnU-Net при подтверждённом наборе T1/T1c/T2/FLAIR; DWI/ADC/SWI/TOF — отдельные маршруты |
| **Позвоночник и костно-мышечная система** | позвонки, диски, мышцы, суставы, колено, таз; затем патологические задачи | Анaтомическая 3D-модель ≠ диагностика дегенерации; выбирать site- и sequence-specific checkpoints |
| **МРТ таза/простаты** | железа и зоны, измерения, очаги при отдельной mpMRI модели | Требуются T2, DWI/ADC и при необходимости DCE; нельзя запускать простатную модель на произвольной MR |
| **Сердце/сосуды** | объёмы желудочков при cardiac cine MRI, аорта, крупные сосуды, диаметры | Cine с временным измерением/ECG-gating отдельно; коронарная CTA — специализированный протокол |
| **Онкология** | области ROI, сегментации, рост в динамике при сопоставимых исследованиях | Локальные task-specific модели по органам, фазам и методике; не обещать стадирование без валидации |
| **Рентгенография** (доп. модальность) | отдельные 2D скрининговые/исследовательские модели | TorchXRayVision/RAD-DINO/MAIRA и аналоги только по подтверждённой лицензии, проекции и задаче |
| **УЗИ, маммография, ПЭТ** (расширение) | отдельные воркфлоу, временная/спектральная/трассерная информация | Не считать поддержанными только потому, что LLM принимает картинки; независимые проверенные пайплайны |

**Критическое требование MR:** по полной совокупности DICOM-серий устанавливать фактические последовательности, сканирующие параметры, поле обзора, геометрию, контраст, время и многосерийность. Текущие эвристики заголовков ограниченны: неизвестная последовательность **не** должна угадываться как T1/T2/FLAIR/DWI/ADC.

**Критическое требование CT:** корректные rescale/HU (если применимо), фаза, толщина срезов, spacing/anisotropy, покрытие, реконструкционный kernel, контраст; обработка полного объёма для 3D-модели, только поддерживаемые ROI и маршруты.

---

## 4. Каталог медицинских моделей, без фиктивных «универсальных» весов

Каждый установленный checkpoint регистрируется в **Model Registry** с:
- \`model_id\`, \`version\`, \`weights_sha256\`, проверенный источник/URL и дата, **отдельные лицензии кода и весов**, разрешённое исследовательское/коммерческое использование, экспортные/региональные условия;
- точная модальность, области, задачи, возрастные/популяционные ограничения, sequence/contrast constraints, input orientation, spacing/voxel order, normalisation, channel count, tensor shapes, CPU/MPS/CUDA compatibility;
- список выходных меток, стандарты координат, postprocessing, пороги, статистики неопределённости, известные ошибки, по каким датасетам и метрикам оценивалась модель;
- пиковая RAM/VRAM, throughput (из измерений, не догадок), max voxels, warmup, versioned pre/postprocessors;
- \`installed/validated/experimental/unavailable\` и reason; **наличие на Hugging Face не означает API endpoint или отсутствие согласия на лицензию**.

Стартовые кандидаты: **Lungmask R231** (лёгкие CT 2D), **TotalSegmentator** (\`total\`, \`total_mr\` и разрешённые задачи), **MONAI Model Zoo** (селезёнка, узлы лёгких, BraTS, простата и др.), **nnU-Net** для задач со специализированными весами; VISTA3D, MedImageParse3D, CT-CHAT и более крупные модели — после отдельного технического/правового аудита.

**MedGemma исключена по пользовательскому региональному/лицензионному ограничению.** Не добавлять её в обязательные зависимости или автозагрузку. Не считать свободно доступными платные/закрытые веса и ограниченные задачи TotalSegmentator. Ничто не должно требовать подписки Hugging Face, Google или OpenRouter для открытия DICOM и локального анализа.

Порядок первого реального end-to-end шага: **open/public legally usable CT chest → Lungmask R231 → реальная маска на исходном MPR → производительность M1, точность на эталонной выборке**. Затем TotalSegmentator \`--fast\`/\`--roi_subset\`; затем специализированный CT lung nodule detector с GPU альтернативой. Не связывать «сегментацию лёгких» с заключением «патологий нет».

---

## 5. Единый конвейер и параллельная оркестрация

\`\`\`text
DICOM source: browser files / authorized DICOMweb / local store
        |
Study Intelligence — ALL series, no silent exclusions
        |
Protocol & anatomy gates / privacy / memory and cost budget
        |
Volume Engine: exact geometry, HU or MR intensity, streaming/tiles
        |
Task Router -- unsupported => explicit stop/warnings
    +-------------------+---------------------+
    |                   |                     |
Local ONNX/MPS      CPU/GPU Worker       Optional VLM analysis
segmentation        targeted 3D nets     Gemini / Claude / GPT
detection ROIs      pathology model      image evidence + context
    |                   |                     |
    +---------- Evidence + provenance --------+
                        |
Spatial QC: registration, units, source-to-output links, conflicts
                        |
Doctor Opus reasoning / critical review / draft report
                        |
Physician verification, edits, sign-off, export
\`\`\`

**Параллельность:** медицинские сети и разрешённые Vision LLM могут исполняться независимо при соблюдении ресурсного и ценового лимита. Второй контур (Claude Opus/Gemini/GPT) получает результаты и может формировать независимую гипотезу, но **несогласие остаётся видимым**. Большинство голосов LLM не является доказательством. Запрещено заявлять, что LLM увидела «все 350 срезов», если ей были переданы 4 JPEG; показывать frame-plan, coverage и источник каждой идеи. Дедупликация, сравнение координат, независимые измерения, quality/critic; при невозможности сопоставить — \`needs_review\`.

**Оптимизация LLM:** по умолчанию одна Vision-модель + независимый специализированный алгоритм, экспертный LLM только при необходимости; расширенный режим Gemini/Opus параллельно включается осознанно. Кэш по разрешённым идентификаторам/хешам и ревизиям моделей, без утечки данных. Сокращать расходы, но **не** качество наблюдения критических ROI.

**Evidence JSON / report:** для каждого наблюдения: provenance (study/series/SOP/frame/3D coordinates), exact model weights SHA/version, target anatomy, finding/measurement and units, confidence *only if calibrated*, uncertainty, protocol/coverage limitations, conflicting agents, provenance state, reviewer status, de-ID state. Отчёт строго разделяет:
1. измеренные данные;
2. результаты конкретных моделей;
3. интерпретации LLM;
4. клиническое мнение врача;
5. непроверенные гипотезы и неизвестные области.

Никаких фальшивых координат, «0 мм», нулевой патологии по отсутствию маски, автоматических диагнозов или произвольных дозировок.

---

## 6. Потоковая обработка полных исследований, включая M1 8 ГБ

**Уже существующий барьер:** пакет NIfTI из \`web/lib/analysis-package.ts\` ограничен **8 388 608 вокселями** (~32 MiB float32). КТ 512×512×300 = **78 643 200 вокселей**, то есть ~300 MiB одного float32 массива и существенно больше при временных копиях/MPR/масках/моделях. Для «большинства локализаций» этот лимит нельзя просто удалить.

**Обязательное изменение:** \`VolumeStream\` + \`StudyJob\`:
- потоковый DICOM decode и/или memory-mapped NIfTI (где поддерживается), chunk/ROI processing с количественно проверяемыми координатами и exact rescale;
- chunk order deterministic, indexed image refs/SOP, qform/sform/RAS↔LPS transforms, spacing, orientation;
- для 3D patch models — overlap, blending, border safety, merging and whole-volume consistency; 2D slicing не имитирует 3D диагностику;
- сохранять данные исследования в локально разрешённом хранилище, **не** отправлять весь NIfTI в API-роут Next.js/Vercel;
- ограничивать concurrency по RAM/VRAM; на M1 8 ГБ одна модель/один volume-job, не открывать бесконечные копии срезов; watchdog, cancel, retry, memory preflight, OOM recovery;
- на CPU/GPU-сервере очередь, job-id, состояние и отдельный изолированный worker; не блокировать event loop Next.js;
- отдельно benchmark: время, peak RSS/VRAM, количество срезов, edge effects, reproduction on Safari/M1, CPU server, NVIDIA.

**Запрет:** повышать лимит до 78 млн вокселей одной константой без решения streaming, backpressure и тестов.

---

## 7. Безопасность, законность и реальные пациенты — обязательные архитектурные gates

**Состояние сегодня: передача реальных пациентов внешнему AI заблокирована** (\`web/lib/patient-cloud-policy.ts\` возвращает \`permitted:false\`; небезопасный общий \`/api/ai\` возвращает HTTP 410). Эксперимент OpenRouter отправляет только математические PNG, не пользовательские DICOM. Наличие API-ключа и согласия в браузере не разблокирует клинические данные.

**Финальная модель безопасности:**
- **Local-only patient mode:** файлы остаются на доверенном Mac/изолированном локальном хранилище; браузер ↔ локальный worker по \`127.0.0.1\`, CORS/Origin, привязка сессии, ограничение FS-path, размер/тип/поток. Локальность не освобождает от роли врача, доступа, аудита и защиты устройства.
- **Authorized private-server mode:** организация разрешает обработку на своём CPU/GPU узле; TLS, mTLS/служебная авторизация, роли, сегрегация арендаторов, изолированная сеть, server-side session, encrypted at rest, retention/delete, журнал действий и инцидентов.
- **External API mode:** **отдельный** правовой/технический релиз: законное основание и согласие где необходимо; DICOM PS3.15 de-identification стандартных/частных тегов, повторные идентификаторы, свободный текст; осмотр burnt-in annotations, лица/биометрических признаков, видео-кадров, структурных метаданных; верификация после обезличивания; договор с провайдером, юрисдикция, локализация и хранение, трансграничная передача, невозможность гарантировать конфиденциальность только по имени «OpenRouter»; per-study release, audit, consent revocation.
- Данные отдельных пациентов НИКОГДА не появляются в GitHub, CI, скриншотах логов, веб-аналитике, клиентском error-reporting, промптах разработчиков, общедоступных демонстрациях или артефактах сборки.
- Ключи \`.env.local\` и серверные secrets, не в браузере/репозитории; никогда не перезаписывать пользовательский \`.env.local\`.
- Разрешения отзываемые; audit не содержит PHI; consent может быть не единственным законным основанием, решение проверяет локальный юридический специалист.
- Клиническая валидация/регуляторная квалификация продукта делается отдельно для выбранного рынка; не заявлять медицинское изделие/сертификацию без подтверждения. ISO 14971, IEC 62304, IEC 81001-5-1 и местные требования оцениваются по применимости.

**Определение «вопросы безопасности решены»:** не фраза в интерфейсе, а независимый документированный security review, threat model, тесты egress/de-id, access-control и audit, провайдерный контракт, доказательства правильного удаления данных, процедура изменения моделей и клиническая оценка. До этого patient cloud **fail-closed**. Локальный реальный анализ возможен по соответствующей авторизации без внешней отправки.

---

## 8. Экономика, бюджеты, подписки, лицензии

**Базовая версия бесплатна по коду, не по вычислительной энергии:** Next.js/Cornerstone и совместимые открытые модели могут использоваться без платного API. Интернет нужен для первичной установки зависимостей/весов, если они ещё не кэшированы; локальный runtime не должен запрашивать подписку или лицензионный токен в процессе обработки, если выбранные веса это допускают.

**Дополнительные расходы:**
- GPU-сервер: аренда/электричество/диски/трафик, отображать оценку \`cost_per_job\` и фактические затраты по метрикам;
- Gemini/Claude/GPT/OpenRouter: входные/выходные токены, размеры изображения, кеширование, цены модели/провайдера и маршрутизация. Нет «бесплатных» токенов по умолчанию. Доступность API по региону/аккаунту подтверждать реальным тестом до предложения запуска;
- отсутствие цены/метаданных = \`unknown cost\`, нельзя обещать бесплатно или допускать неконтролируемую автоматическую серию запросов.

**Требования:** per-job preflight (худший допустимый бюджет), max output tokens, max samples/frames, max retries, rate limiting, concurrency, daily/monthly caps, отдельная кнопка «разрешаю оплачиваемый cloud-job», kill switch, ledger provider usage and billing response, idempotency key, отмена не отменяет уже списанные токены. Приоритет fail-safe при превышении бюджета. Шлюз по OpenAI-compatible API **не** гарантирует одинаковое ценообразование и способности моделей.

**Коммерческая лицензия:** MIT/Apache код и Apache веса могут иметь разные лицензии; restricted tasks/частные datasets/moral licenses требуют проверки. Свести лицензии в модельный паспорт, не включать коммерчески запрещённые веса в default или контейнер. Модели Hugging Face = открытые файлы, не обязательно доступные Inference Endpoints или свободные в Крыму/РФ.

---

## 9. Проверяемое состояние на 2026-10-11 (main GitHub)

### Фактически реализовано и есть код/тесты

- Next.js интерфейс, локальная загрузка DICOM и исследование серий; Cornerstone 2D; MPR/3D для технически совместимых серий и с ограничениями; функциональность зависит от браузера/памяти и не является клинически валидированной.
- Study Intelligence: технические метаданные, индекс всех серий, ограниченные эвристики последовательностей, предупреждения по геометрии и приватности; **не** подтверждает полноту протокола или патологию.
- Local frame plan / thumbnails и WebAudio сигнал opt-in после успешных исследовательских операций; Mac completion chime утилита.
- Полный экспорт **одной совместимой серии до 8 388 608 вокселей** в NIfTI + проверяемый JSON паспорт; обратный импорт NIfTI mask, наложение в MPR, проверка LPS/RAS/геометрии/SHA-256 и источника; маска без паспорта помечается менее проверенной.
- \`scripts/run-local-onnx.py\`: настоящий **CPU ONNX Runtime** для **строго совместимых 2D binary one-channel моделей**, slice-by-slice; доверие к checkpoint профилю, SHA и геометрии. CI с **синтетической Identity ONNX сетью** успешен, **ни один pretrained медицинский checkpoint не подключён**.
- OpenRouter catalogue/readiness только в localhost dev, проверка ключа без передачи его значения браузеру; настоящие оплачиваемые OpenRouter вызовы на **искусственных математических PNG**, не на пациентах. Реальные provider entitlement/format надо проверять локально с ключом; CI использует mocks.
- Privacy gate для реального облачного пациента всегда закрыт; общий произвольный API отключён.
- PR **#6–#11 уже объединены** в \`main\`; это не означает автоматическое развёртывание на Mac до \`git pull\`/перезапуска.
- Сборка, unit, browser и ONNX synthetic-run tests в GitHub Actions. **Не** утверждать проверенное клиническое качество, конкретную Safari/M1 benchmark производительность или SaaS production.

### R1: инженерное дополнение, отдельная приёмка ещё не завершена

- Добавлены `services/imaging-ai/r231.py`, `worker.py`, опциональная браузерная кнопка и явная установка проверенных официальных весов R231; CPU, batch 1, один job, loopback/session/Origin, отмена, SHA и точная геометрия маски.
- Настоящая R231 проверена через HTTP на опубликованном двухсрезовом CT-фрагменте авторов Lungmask, Linux x86_64. Это не полная грудная клетка и не Mac benchmark. Веб-регрессии остаются синтетическими.
- Экспортный лимит 8 388 608 вокселей сохранён; большой full-resolution CT не поддерживается. Пациентский режим воркера и cloud остаются закрыты. Объединение специализированных находок с LLM через пространственный Evidence Engine ещё не завершено.
- Источники, ограничения лицензирования, точные команды и фактические замеры: [LOCAL_LUNGMASK_WORKER.md](LOCAL_LUNGMASK_WORKER.md), [R1_LUNGMASK_VERIFICATION.md](R1_LUNGMASK_VERIFICATION.md). **R1 PARTIAL**, без клинической валидации.

### Ещё НЕ готово (не маркировать как «уже работает»)

- Полная приёмка Lungmask на разрешённой полной КТ/Safari/M1; TotalSegmentator/MONAI adapters/checkpoints и их независимые тесты.
- Приёмка настоящей R231→MPR на полной открытой серии; клинический однокнопочный анализ пациентов (текущая кнопка/worker только исследовательские и ограничены по объёму).
- Browser-side WebAssembly ONNX с установленными реально совместимыми весами.
- Потоковое чтение больших 512×512×N CT/MRI сверх текущего NIfTI экспортного лимита, изоляция worker, очередь, отмена, M1 measurement.
- Реальный детектор патологий по полноценному клиническому протоколу/вся анатомия, внешняя валидация и sensitivity/specificity/FROC; клинические отчёты с sign-off.
- CPU/GPU production worker, DICOMweb/Orthanc для серверного хранения, мультитенантность/логины/безопасные права.
- Разрешённая и проверенная облачная обработка **реальных** пациентов, деидентификация с доказательной проверкой pixels/tags, провайдерные контракты/политики.
- Гарантированная доступность любых Gemini/Claude/Opus API в конкретной юрисдикции, автоматическое списание/оплата API токенов с бюджетным контролем.

---

## 10. Roadmap по этапам и gate of done

| Этап | Результат | Критерий завершения |
|---|---|---|
| **R0 (есть)** | Viewer, MPR/3D, Study Intelligence, mask export/import, synthetic AI, ONNX CPU runner | Существующий CI и проверка фактического кода |
| **R1 (следующий)** | **Local AI Worker v1: Lungmask** → браузерная кнопка, реальные open CT, MPR overlay | Веса/лицензия/sha проверены; работает на Mac M1; нулевая передача patient pixels; точные маски/geometry + RAM/time benchmark |
| **R2** | TotalSegmentator CT/MR адаптер + CPU/MPS auto-fallback, model registry | Легально разрешённые задачи, проверенный NIfTI/параметры, отказ unsupported, reproducible masks |
| **R3** | Streaming/tiling крупных исследований; Browser ONNX lightweight | Реальная 512×512×N CT без OOM и без нарушения ориентации; браузерный graceful fallback |
| **R4** | CPU/GPU Worker, очередь заданий, контракт FastAPI, private deployment | Те же inputs/results на разных узлах, отмена/ресурсные лимиты, end-to-end test |
| **R5** | MONAI task-specific detectors: lung nodules, brain MR, abdomen and others | Отдельный checkpoint, acquisition gate, reference dataset, task-specific metrics/uncertainty |
| **R6** | Evidence Engine + параллельные (опциональные) Gemini/Opus и специализированные сети | Сопоставление срезов и ROI, конфликт/abstain, расходы по заданиям, без несанкционированного cloud |
| **R7** | Production patient privacy, access roles, auditable de-ID, signed reviews | Независимый privacy/security audit, законное основание/договоры/отзыв/retention, клиническая оценка |
| **R8** | Clinical pilot / release per territory | Достоверная валидация на внешних исследованиях и протоколах, acceptance врача, применимое регулирование |

Этапы могут идти параллельно только если их безопасность/проверки не подменяются друг другом. **Приоритет прямо сейчас — R1: реальная Lungmask на открытой легальной КТ в браузерном Opus через локальный worker, а не новый красивый демо-план**.

### Общий definition of done для каждой модели

1. Реальные веса доступны на проверенном источнике, SHA и лицензия зафиксированы, pin по версии.
2. Модель реально исполняется локально или на выбранном сервере, без мока; отказ если неподдерживаемые входы.
3. Вход/выход: полная нужная серия, корректные LPS/RAS и unit tests против независимого эталона.
4. В исследовании видны source/slice/ROI/mask и ограничения; недостающие данные не превращаются в «норму».
5. Измерены RAM/VRAM, время, отмена, деградация, OOM, ручной тест в Safari Mac и CI.
6. Есть клинически релевантный набор тестов и показатели по задаче (Dice/HD95, FROC, sensitivity, specificity, calibration), ограничения генерализации отмечены.
7. Установлена степень готовности (engineering / research / clinically validated), без автоматического преувеличения.
8. Любые обработка персональных данных и внешняя передача проходят соответствующие privacy gates.
9. Обновление в отдельной ветке, CI зелёный, ручной PR и merge. Не переписывать \`web/.env.local\`, не пушить напрямую в \`main\`.

---

## 11. Правила для следующего чата / Cursor

**Стартовая команда:** «Продолжай Opus Radiology AI по \`docs/OPUS_RADIOLOGY_MASTER_SPEC.md\` и \`REQUIREMENTS.md\`. Проверь актуальный \`main\`, список моделей, status GitHub Actions и \`docs/LOCAL_ONNX_AI.md\`. Работай над ближайшим незаконченным этапом: R1 Local AI Worker Lungmask. Не ломай 2D/MPR/3D; не раскрывай OpenRouter ключ; не включай реальный patient cloud; не сливай PR самостоятельно. После готовности покажи конкретный PR, фактические тесты и одну команду для Mac».

- Пользователь работает в Cursor на **MacBook Air M1 8 ГБ**; рабочий GitHub-клон по указанному пути. \`localhost:3000\` — ожидаемый адрес, но реальный порт сверяется с Next.js, не угадывается.
- Цель не «демо LLM», а **большинство локализаций КТ/МРТ** через комбинацию task-specific моделей, поэтапного оборудования и интеллектуального объединения результатов.
- **Важнее реального результата, чем обещания:** нельзя утверждать, что уже работает Lungmask/TotalSegmentator на реальной КТ без выполненного теста и зарегистрированных весов.
- Модель «в каталоге OpenRouter» ≠ доступ к API, коммерческая лицензия, диагностическая пригодность и законное право передавать реальные медицинские данные.
- Следующий этап завершён только при открытой законной публичной/обезличенной КТ и видимой на MPR реальной маске, связанной с исходной серией и проверенной геометрией.

**Сопутствующие файлы:** корневой \`requirements.txt\` (минимальные Python зависимости), \`services/imaging-ai/requirements-*.txt\` (опциональные тяжелые пакеты), \`REQUIREMENTS.md\` (приёмочные условия), \`AGENTS.md\` (памятка для следующих AI разработчиков). Next.js зависимости — только \`web/package.json\`.


## Bounded local upload increment — 2026-10-11

On baseline main `6ae278b6cdf678cae9e0b92c0777bd5c3b05043a` (PR #13 merged),
local R231 browser submission now serializes exact float32 NIfTI in two passes:
incremental SHA-256 then sequential acknowledged 128 KiB blocks. No whole-volume
export buffer/Blob is allocated by this local action; manual download still uses
the existing full buffer. Worker commits only complete, SHA-bound inputs and
rejects replay/concurrent writes. Cancellation deletes/reaps, including mid-upload.
Browser mask download enforces declared bytes while reading.

**DATA-02 remains PARTIAL for transport only**, not large-study acceptance:
8,388,608 voxel and 48 MiB MPR raw-volume guards remain unchanged. Cornerstone
still holds its decoded volume, returned masks still allocate a complete label
array, and upstream Lungmask preprocessing/postprocessing can hold full-volume
copies. Native full chest, bounded whole pipeline, actual R231 browser overlay,
Safari/M1 8GB system memory and independent clinical metrics remain pending.
Four modes, optional Gemini/Claude through Evidence and patient/cloud OFF remain
unchanged. See `docs/R1_LUNGMASK_VERIFICATION.md` for separately labelled actual
model results and synthetic browser tests. R1 is still PARTIAL.


## Actual browser R231 increment — 2026-10-11

On baseline main `cfacb95e4610cb1d9e1bc15c1edf6b9bdad4f34c` (PR #14 merged),
a reproducible opt-in test now verifies **actual trained R231 → browser MPR**
on 32 unchanged native consecutive CT slices from the public TCIA LCTSC dataset
(CC BY 3.0), explicitly selected from 103 original slices. Exact independently
calculated full scalar input SHA, source grid, real model/mask binding, both lung
labels, all three rendered MPR planes and job deletion were verified on Linux.
No real reference pixels/screenshots, raw source identifiers or tokens are stored
in GitHub/CI artifacts; only technical verification JSON. Default CI is synthetic.

**R1 remains PARTIAL**: this is a declared partial slab, not complete chest.
No full lung-volume, manual-contour Dice, M1/Safari/total system RAM or clinical
accuracy acceptance. The 8,388,608-voxel and 48 MiB MPR guards stay unchanged.
The UI explicitly warns that mask volume refers only to loaded slices. Four
execution modes and specialist + optional Gemini/Claude through Evidence remain
the architecture; cloud/patient/remote gates stay closed.

See `docs/R231_BROWSER_REFERENCE.md` and the measured technical report at
`docs/verification/r231-browser-linux.json`. After the optional environment and
checkpoint are installed, reproduce with:
`bash scripts/test-r231-browser.sh --download-public-reference`.

## Streamed R231 memory increment — 2026-10-11 (feature branch)

Baseline main `ebe7ca2` contains the adaptive Safe guard. The previous adapter's
32-of-103 public native-reference browser run has a user-supplied Mac PASS;
whole-system memory/Safari/full-chest and clinical accuracy remain unaccepted.

The optimized local CPU adapter processes native slices individually, retains
whole compact-volume postprocessing, allocates one native uint8 mask and avoids
simultaneous weight storage. It omits eager image readers and releases unused
inference tensors. Exact float32 model operations, source geometry and the
official weights binding are preserved; no smaller replacement study, lower
precision, disabled postprocessing or LLM fallback is used.

Actual Linux browser R231/MPR/deletion verification passes with the same complete
mask SHA. Same-session model peak RSS falls 828.05→701.77 MiB (15.25%), and Safe
admission for 512×512×32 falls 1496→1219 MiB with unchanged margin/runtime reserve.
This is a bounded partial-reference optimization, not optimized Mac/full-chest
acceptance. Four modes, optional Gemini/Claude through Evidence and closed
patient/cloud/remote gates remain unchanged. Technical evidence:
`docs/verification/r231-low-memory-linux.json`, `docs/R231_SAFE_MODE.md`.


## Mac resource report and tensor lifetime follow-up — 2026-10-11

PR #17 is merged into main `490fec3`; its Python Actions are green. A new
user-supplied Mac M1/8GB run of the streamed implementation passes actual R231,
257 chunks, identical full mask SHA, three MPR overlays and job deletion. Model
high-water is **752.97 MiB**, not a demonstrated improvement over the earlier
709.86 MiB Mac run. System minimum available RAM is about 1127.61 MiB; swap peaks
102.8125 MiB above its starting value and ends 30.8125 MiB higher. All tracked
process groups are zero during the completed 30-second post-observation. UI
responsiveness was not assessed. Original reports contain no commit SHA. See
`docs/verification/r231-low-memory-mac.json`.

The follow-up releases upsampling/cropped-skip/block-input tensors before later
convolutions, using the same pinned residual=False Sequential operations. Exact
logits and tensor lifetime tests plus actual public-reference browser verification
are required. Keep Safe thresholds unchanged: functional Mac PASS does not
accept memory reduction, repeated-run responsiveness, Safari, full chest or
clinical accuracy. Four modes/Evidence/optional LLM and patient/cloud OFF remain.


Follow-up validation: 49 Python tests pass with the optional stack. Two fresh
sequential adapter runs on the same Linux host/reference/checkpoint measure
763.51→596.06 MiB model peak (21.93%). Both include getrusage high-water; the
baseline uses the PID namespace fallback, while the optimized run also samples
psutil RSS. The separate actual browser run passes at 636.20 MiB, with identical
mask SHA, three MPR planes and job deletion. This is a single measured comparison,
not a Mac reduction claim. Safe admission remains 1219 MiB. See
`docs/verification/r231-tensor-lifetime-linux.json`.

## Specialist Evidence increment — 2026-10-11

On main baseline `5690b59`, the user supplies a checked-commit `4528b24` Mac
partial-reference PASS at 730.64 MiB model peak without whole-system swap growth.
See `docs/verification/r231-tensor-lifetime-mac.json`; this predates the new UI.

The next increment connects the existing source-bound R231 result to local
specialist Evidence: mask-derived label counts/volumes, grid bounds and occupied
LPS points, model/version/weights/input/mask SHA, local review marks, MPR
navigation and JSON export. It reads the existing mask in bounded yielding blocks
without another volume allocation or model run. Full organ coverage, diagnoses,
confidence, clinical accuracy and signed review are not claimed.

Four modes remain the architecture; local specialist execution does not depend
on Gemini/Claude. The optional LLM research contract stays separate pending a
comparison/reconciliation adapter. Patient/cloud/remote gates and voxel/RAM/MPR
caps remain unchanged. See `docs/SPECIALIST_EVIDENCE.md` for implemented behaviour
and planned conflict checking, persistent physician audit and clinical sign-off.

## Local measurement reconciliation increment — 2026-10-12

Baseline main `0b84bc4` contains manually merged PR #19 and green Web Actions.
A metadata-only adapter now imports explicit `opus-llm-measurements/v1` claims
beside bound specialist Evidence. It compares label-volume values only with the
same request/input/source hashes, frame count/modality, target observation/weights
and declared loaded-slice scope. Both values and their signed difference stay
visible; wrong binding, unknown/full-organ scope, unsupported metrics and rejected
or absent labels yield reasons to abstain. Every result remains `needs_review`.

Templates contain null measurements and unknown coverage. Imported provider,
independence and claimed coverage are not authenticated: equal numbers are not
clinical agreement. Legacy orchestra JSON lacks this quantitative binding and
remains in its separate source-slice viewer. Local export includes both metadata
snapshots and the current review. No image/mask copy, inference, paid call or
patient/cloud activation is added; all four modes and resource caps remain.

See `docs/EVIDENCE_RECONCILIATION.md`. Spatial ROI reconciliation, authenticated
independent inference, clinical thresholds, versioned physician audit/sign-off,
Safari and full-chest R1 acceptance remain planned or PARTIAL.

## Bound LLM spatial point increment — 2026-10-12

On baseline main `9c96502` (PR #20 manually merged; green Web Actions), local
measurement claims can additionally provide an explicit LPS-mm point and current
mask SHA. Source/input/request/target binding, geometry extent and review are
checked before MPR navigation. The active mask supplies a single nearest-neighbour
label lookup, including permuted/flipped grids; no additional volume or inference.

The UI shows target label, different label, background or unavailable sampling,
and opens the point in all three MPR planes. Wrong binding/mask, outside-volume
points and rejected/missing targets disable navigation. Templates leave points
null. A label hit is not validation of pathology and background is not a negative
diagnosis. Numeric comparability and point QC remain separate; all output is an
unverified research draft requiring review. See `docs/EVIDENCE_RECONCILIATION.md`.

Full spatial lesion/ROI reconciliation, authenticated independent model evidence,
durable physician audit and clinical sign-off remain planned. Four modes, optional
LLMs, privacy gates and memory/voxel/MPR limits are unchanged; R1 is still PARTIAL.

## Local review journal increment — 2026-10-12

Baseline main `601d78d` includes manually merged PR #21 and green Web Actions.
The specialist Evidence card now records every status change/reset as a bounded
local journal: revision, observation, previous/new status, declared timestamp
and unverified reviewer role. Evidence/comparison export preserves that history;
the standalone journal can restore decisions only onto the same verified
source/input/request/mask/model. Current history must remain an identical prefix:
older, forked, foreign or malformed imports cannot erase local decisions.

No measured data/geometry/mask is replaced, and rejection still disables
comparison/navigation for that target. Page-memory state and explicitly downloaded
JSON are implemented; authenticated clinician access, tamper-proof persistent
audit, trusted timestamps and signature remain planned. This is research review,
not clinical sign-off. See `docs/EVIDENCE_REVIEW_HISTORY.md`.

The 512-event/256-KB journal bound adds metadata only. No model rerun, volume copy,
guard change, paid provider or patient/cloud/remote activation. Four modes and
Mac/Safari/full-chest/clinical R1 acceptance remain unchanged.

## Local printable report increment — 2026-10-12

Baseline main `2c5d090` contains manually merged PR #22 and green Web Actions.
The Evidence and comparison cards now download an offline printable HTML report
separating mask measurements, imported LLM hypotheses, numeric/spatial QC and
current local history. Source/model/grid/hash provenance and coverage limits are
explicit. Rejections and reasons not to compare remain visible; missing/empty
evidence is not a normal finding. Review-history consistency is checked before
export. No clinical opinion, confidence or physician signature is invented.

The report has fixed print CSS, escaped text, a no-network/no-script policy and
no image/raw-payload embedding. Optional browser print/save-PDF uses the local
file; generation is metadata-only, capped at 2 MiB, without model reruns or
volume copies. This is an unsigned research snapshot, not an authenticated
clinical report or de-ID guarantee. See `docs/EVIDENCE_REPORT.md`.

Clinical text editing/sign-off, protected report storage/audit and Safari print
acceptance remain planned. Four modes, optional LLMs, all resource limits and
patient/cloud/remote OFF remain unchanged; R1 is still PARTIAL.

## Separate reviewer draft increment — 2026-10-12

On baseline main `0c84fab` (PR #23 manually merged; green Web Actions), a plain
reviewer text draft is now distinct from mask measurements and imported LLM
claims. Explicit saving appends a bounded version, linked to source/mask/model
and an exact canonical review-prefix SHA. Changed review marks make the prior
text require recheck; saving after inspection records a new association.

Unsaved edits block full Evidence/comparison/report export. Saved versions export
and restore locally, refusing foreign/older/forked or incompatible review files.
HTML shows the latest text in a separate unsigned reviewer section, with stale/
cleared/missing state. Clearing latest text retains prior saved versions. It
does not change measurements, provider output or comparison decisions.

This is not authenticated clinical opinion, signature, de-ID or protected
persistence. See `docs/REVIEWER_NOTE.md`. Patient/cloud/remote OFF, four modes,
resource limits and R1/Mac/Safari/full-chest/clinical acceptance stay unchanged.


## Label-linked reviewer drafts — 2026-10-12 (feature branch)

Baseline main `dcaf69b` has PR #24 manually merged and green Web Actions.
The existing local note journal now keeps independent latest general/label text.
Optional observation IDs must match current specialist Evidence exactly. Targeted
journals use v2 so older clients refuse instead of misattributing label comments;
older v1 general files keep their shape and prefix. MPR navigation reuses the existing
occupied-label point, not an invented lesion/ROI. Unsaved edits block target
switching and full exports. HTML retains latest text and stale/cleared state per
target. Review changes conservatively stale all targets; reconfirmation is per
target. The shared cap remains 32 versions total, not 32 per label.

See `docs/REVIEWER_NOTE.md`. This is metadata-only unsigned research text, not
clinical approval, protected storage or an authenticated audit. No model rerun,
volume copy, resource-guard change, .env.local change or patient/cloud/remote
activation. Four modes and R1/Mac/Safari/full-chest/clinical boundaries remain.


## Local cloud privacy preparation — 2026-10-12 (feature branch)

Baseline main `335d6d3` includes manually merged PR #25 and green Web Actions.
The user's next goal is cloud analysis only after de-identification. The local
Vision plan now prepares bounded windowed PNG copies without DICOM/private
metadata, original UIDs/filenames or clinical/reviewer text. PNG ancillary blocks
are stripped with CRC/size/encoding checks; actual opaque-black raster redaction
leaves source/MPR/Evidence untouched. Each exact copy needs separate local text/
visual checks bound to its SHA; redaction/restart resets review. Explicit local
candidate export only, no network or provider/model run.

This is PARTIAL privacy preparation, not a trusted de-ID release or DICOM file
conformance claim. The candidate retains unverified/sampled-only and transmission
false. OCR/defacing, independent privacy acceptance, server clinician/study
controls, provider context and audit/retention remain pending; arbitrary `/api/ai`
stays HTTP 410 and forged client flags cannot enable it. See
`docs/CLOUD_DEIDENTIFICATION.md`. Four modes, optional-LLM Evidence separation,
.env.local, all R231/MPR/resource guards and R1 acceptance stay unchanged.


## Local privacy OCR assistance — 2026-10-12 (feature branch)

Baseline main `d48f7ff` includes manually merged PR #26 and green Web Actions.
Privacy copies now support opt-in actual Tesseract RU/EN text localization,
SHA-bound native rectangles and batch raster redaction. Recognized strings remain
in ephemeral workers; only coordinates/uncalibrated OCR confidence reach UI.
Positive detections require hiding or an explicit local non-identifying-text
acknowledgement; counts are retained. Re-scan/image changes revoke prior marks;
zero detections never authorize cloud or complete human review.

Pinned code/core/language assets are served as verified static same-origin GETs,
not a pixel upload endpoint. No CDN, persisted OCR/image cache or provider call.
One same-tab slot serializes OCR and R231; owned workers stop on cancel/source
replacement/failure/30-second timeout. This is not cross-tab/OS memory admission
or an M1/Safari benchmark. All existing worker/resource/MPR/SHA guards remain.
See `docs/LOCAL_PRIVACY_OCR.md` for pins, licensing, tests and pending independent
privacy/server release. Four modes, optional LLMs through Evidence, .env.local,
patient/cloud/remote OFF and R1 boundaries remain unchanged.


## Local privacy review journal — 2026-10-12 (feature branch)

Baseline main `28be9d8` includes manually merged PR #27 and green Web Actions.
Bounded local history now records copy SHA changes/rectangles, OCR start/result/
cancel/failure and explicit human decisions. Replay checks current exact PNGs,
redactions and review state before exports. Separate metadata-only journal and
reviewed copy+journal bundle downloads complement the unchanged candidate format.
No recognized text, original UIDs, patient/context text, token or error text is
recorded. Capacity is 128 events; OCR reserves a terminal slot. Restart creates a
new session; no silent truncation, automatic persistence or import is added.

This is unsigned sampled-copy history with an unverified clock/actor, not clinical
source verification, protected audit or a trusted de-ID release. Server/privacy/
provider acceptance remains pending; patient cloud remains OFF and `/api/ai` 410.
See `docs/PRIVACY_REVIEW_JOURNAL.md`. Four modes, optional-LLM Evidence separation,
.env.local, R231/Safe/MPR guards and R1/Mac/Safari/full CT boundaries remain.


## Local privacy bundle restoration — 2026-10-12 (feature branch)

Baseline main `42ea468` includes manually merged PR #28 and green Web Actions.
Local reviewed copy+journal files now restore onto matching current initial
previews after bounded PNG/SHA/replay/digest checks and sequential cancellable
decoding. Nonempty current history requires an exact same-session prefix;
older/forked/foreign files and failures leave current work intact. Restore
preserves raster redactions/history and appends v2 reset events, clearing both
human checks and transient OCR/acknowledgement. Re-review is required for export.
Native v1 files remain unchanged; new clients accept full v1/v2 bundles.

This is explicit local restoration, not protected storage/authenticated provenance
or trusted de-ID. No patient cloud release, server upload, model rerun, volume
allocation, .env.local change or guard relaxation. Four modes, specialist/optional
LLMs through Evidence and R1/Mac/Safari/full CT/clinical boundaries remain. See
`docs/PRIVACY_REVIEW_JOURNAL.md` for versioning, limits and verification.


## Preferred Vision/evaluator routing — 2026-10-12 (feature branch)

Baseline main `5f65cfe` includes manually merged PR #29 and green main Web Actions.
The user's exact Gemini 3.8 Flash + chosen Sonnet 5.5/Opus 5.5/GPT-6.1 Sol profile
now replaces alphabetic catalogue examples in the synthetic browser trial.
One main selection drives the selected Polza/OpenRouter gateway; missing exact
models/modalities refuse without downgrading. Polza's documented metadata API is
connected. The chosen evaluator, rather than Vision itself, runs the image critic
and text synthesis. Five calls and existing cost guards remain; cancel/selection
changes abort client/server requests and stale results are discarded.

Public catalogue presence is not account access or radiological accuracy. Paid
completions are mocked in verification; no patient data/new paid test/medical
model rerun, .env.local change, cloud release or guard relaxation. Four modes and
specialist/optional-LLM Evidence separation remain. See `docs/PREFERRED_AI_MODELS.md`.


## Local privacy preparation readiness — 2026-10-12 (feature branch)

Baseline main `4473328` includes manually merged PR #30 and green Web Actions.
Each sampled copy now shows SHA-bound optional OCR, both human marks and redaction
count; busy/stale/unreviewed states remain distinct. Seven server policy checks
are shown separately as unconnected. On-demand metadata-only readiness export
validates exact PNGs/current journal; it never serializes pixels, words, PHI,
tokens or raw history, and cloud/de-ID flags always remain false.

Rendering does not decode/hash/copy images or run models/network. This is an
unsigned local snapshot, not trusted privacy acceptance or server authorization.
No new paid call/patient transfer/.env.local change or guard relaxation. Four
modes, specialist/optional-LLM Evidence separation and R1/Mac/Safari/full CT
boundaries remain. See `docs/LOCAL_PRIVACY_READINESS.md`.


## Bounded native CT slab — 2026-10-12

Baseline main `22dc41b` has PR #31 merged and green Web Actions. An explicit
consecutive native CT range now feeds MPR and the existing local R231 action,
while full 2D remains available. The entire source geometry is rechecked; bounds
are min(32 frames, existing voxel/raw/file limits). No resampling or pixel copy.
Selected SOP identity, shifted LPS/scalars/SHA and strict worker contract remain
bound. Selection/source changes tear down masks/packages/jobs; owned 2D decoded
cache is released. See `docs/BOUNDED_CT_SLAB.md`.
This is partial slab support, not full-CT stitching, a trained-model rerun or a
Mac/Safari benchmark. Four modes/Evidence/optional LLMs, .env.local, patient/cloud
OFF and R231/Safe/resource limits stay unchanged; R1 remains PARTIAL.


## Full supplied CT disk-streaming stage — 2026-10-12

Baseline main `b60badd` includes manually merged PR #33 and green Web/Python CI.
A separate opus-analysis-request/v2 path decodes one owned native CT plane at a
time, hashes/transmits exact HU in bounded chunks, preserves whole compact R231
postprocessing and writes native masks per plane. Completed jobs serve only
SHA/source/range-bound MPR derivatives and export full quantitative research
Evidence without secrets. Native support is capped at 512x512x300; v1/manual
export/generic mask/MPR guards remain unchanged. Safe admission/runtime pressure,
one-job/origin/token and TTL controls remain. See docs/FULL_CT_STREAMING.md.
266 Web tests; 58 Python tests with 3 optional medical-stack skips; production
build/typecheck/Chromium use actual synthetic DICOM/rescale but mocked inference.
No new trained full-CT/M1/Safari/system-memory/clinical acceptance is claimed.
Four modes and specialist/optional-LLM separation remain; patient/cloud/remote
release and .env.local are unchanged. R1 remains PARTIAL pending hardware/model
acceptance. The public reference preparer has explicit --full-series opt-in;
default 32-slice verification stays unchanged.
