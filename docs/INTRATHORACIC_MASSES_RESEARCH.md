# Внутригрудные образования · реальный медицинский приоритет Opus

## Какой результат нужен врачу

КТ грудной клетки рассматривается не только на предмет интерстициальных изменений.
Обязательно отдельно искать **лёгочные узлы (до 30 мм), объёмные образования лёгких
(свыше 30 мм), медиастинальные первичные массы, лимфоузлы средостения/корней,
образования плевры и грудной стенки**.

Нельзя считать отсутствие сегментации R231 или ответа LUNA16 отрицательной
проверкой всех образований. Lungmask R231 размечает лёгкие. MONAI LUNA16
RetinaNet предназначен для лёгочных узлов, не универсален для больших масс.
TorchXRayVision Mass выдаёт изображение-уровневый балл **рентгенограммы**,
а не координаты объёмного образования КТ.

## Уже реализованное локальное взаимодействие

В браузерной лаборатории `/viewer` → выбранная подлинная DICOM-серия КТ
грудной клетки → **«КТ грудной клетки · образования и лимфоузлы»**.
Врач отмечает отдельную находку, её анатомический компартмент, сторону,
действительный 1-based номер исходного среза, ручные длинную и короткую оси
(мм), структуру и контрастирование. Обязательное подтверждение ручного
просмотра предшествует добавлению. Компартмент строго привязан к типу
образования; лёгочная масса >30 мм не маскируется в категории узлов.
Локальный индекс проверяется против **точного ID выбранного оригинального
DICOM-файла**, а не произвольного номера и не чужой серии. Нельзя добавлять
срез вне загрузки. В отчёт ID, имя файла, SOP/Study UID или координаты
пациента не копируются; произвольная редакция истории также исключена.

Результат — **неподписанный врачебный исследовательский список**, без
автоматической детекции, патологической классификации, верификации 3D-границ,
стадии TNM, отрицательного скрининга или облачной передачи.

## Обнаружены настоящие pretrained-кандидаты

**1. Лимфоузлы средостения на контрастной КТ — Bouget et al., 2022.**

Официальный исходник: https://github.com/dbouget/ct_mediastinal_structures_segmentation
(BSD-2-Clause для репозитория). Автор публикует настоящие модели
`UNet-SW32` (по 32 среза), `AGUNet`, `CT_Lungs`. Репозиторий содержит
`setup.py` с конкретным URL оригинального `models.zip` и контрольной
**MD5 `434775bebd64910e01f4198eab251666`**; скачивание оригинальных
весов происходит из авторского Google Drive. По авторскому README возможен
**CPU inference** при отсутствии `-g` и в Docker CPU.

Учебные/экспертные маски: LyNoS, 15 КТ с сегментацией лимфоузлов;
дополнительные оригинальные NIH CT Lymph Nodes, 89 пациентов (выяснить
перекрытие обучающих пациентов до независимой оценки).
Данные: https://github.com/raidionics/LyNoS

**Важно:** пока НЕ выполняли загрузку весов, SHA-256 файла,
подлинный forward на разрешённой положительной КТ, оценку ложноположительных
сосудов, пропущенных узлов и потребление RAM. Нельзя запускать оригинальные
старые TensorFlow зависимости прямо на рабочем Mac M1 8GB без preflight.
Для следующих испытаний выбрать **отдельный CPU Linux worker**, ограничить
RAM и потоков, загрузить веса с проверкой MD5 → локальный SHA256, затем
выполнить настоящий прогон и сравнить с отдельной экспертной разметкой.
Без GPU, без реальных пациентских облаков.

**2. Опухоль лёгкого на КТ — Carles et al., Eur Radiol 2024.**

Оригинальная публикация и веса:
https://github.com/MonCarFa/PET-CT-Lung-Segmentation-Models

Автор предоставляет отдельный **CT** nnU-Net v1 pretrained checkpoint
`Task998_LungCTSegmentation`, скачиваемый по точной ссылке на Kaggle со
страницы автора. Не использовать PET-модель `Task999` вместо CT.
Реальный запуск на разрешённой опухоль-положительной КТ, SHA, RAM, лицензия
и независимый Dice пока не подтверждены; клинического внедрения нет.

**3. Первичная опухоль средостения, плевра и грудная стенка.**

Веса настоящей отдельной патологической модели пока не подтверждены.
Модель лимфоузлов не заменяет модель опухоли вилочковой железы,
лимфомы/герминогенной опухоли; плевральный выпот ≠ опухоль плевры.
Эти категории оставлены НЕЗАКРЫТЫМИ в реестре.

## Следующий критерий медицинской готовности

Не число подключённых библиотек, а локализованное, подтверждённое
исследование: оригинальный pretrained checkpoint → исходная CT → native-space
3D-маска узлов/образования → точный источник, размеры/объём → независимая
экспертная разметка и sensitivity/false-positive rate → врачебная оценка.
LLM Gemini/Opus могут независимо обсудить находку, но не заменить
патологическую нейросеть или независимую валидацию.

Любая реальная передача обезличенных изображений в OpenRouter требует
предыдущих юридических/операторских допусков; данная ветка ничего не
отправляет в сеть.

## Original lightweight ONNX CT mediastinal nodes — genuine CPU research

More practical than original TensorFlow 1.14 is the same publisher team's
Raidionics release `v1.3.0-rc`: original pretrained
`Raidionics-CT_LymphNodes-v13.zip` (105,186,900 bytes, SHA-256
`922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08`).
The release separately offers `CT_Tumor` (233,395,992 bytes), which is NOT
interchangeable with the lymph node checkpoint.

The official vendor public inference test sample
`Samples-RaidionicsSegLib-UnitTest-Mediastinum-v1.5.zip`
(27,321,314 bytes, SHA-256
`3bc452580051dbea0f67caa52c4eb09c75eafdde9e8e7ff60c3a143ec94dce1f`)
contains a CT and an original lung mask to provide source geometry to the
model's preprocessing. We use the **original** author `raidionicsseg==1.5.2`
with ONNX Runtime CPU, no TensorFlow, torch, GPU, browser inference or Mac
processing; original model preprocessing and 3D output are not imitated.
`--mode prepare` checks both published exact archive sizes and SHA-256,
refuses unsafe ZIP entries, identifies original ONNX and preprocessing;
`--mode infer` invokes the actual author library in an independent CPU
process capped to 4.8GiB RSS/1100sec; `--mode evaluate` requires native
image grid and reports number/volume of detected node-label voxels and
all model/source digests.

**Research caveat:** vendor unit-test sample is **NOT** automatically an
independent radiologist-positive LyNoS case or diagnostic validation.
Report independently expert-masked Dice only after a separate licensed
human-annotated positive CT passes the same source SHA/affine checks.
A real ONNX process success proves only model execution, NOT sensitivity,
specificity, metastatic staging, malignancy classification, or patient
eligibility. No patient data or images leave the GitHub runner.

Original public release:
https://github.com/raidionics/Raidionics-models/releases/tag/v1.3.0-rc
Original CPU engine:
https://github.com/dbouget/raidionics_seg_lib


### VERIFIED original CPU ONNX run (19 October 2026)

The research run **actually completed** with original release archives and matching SHA-256:

- [GitHub Actions run 39311359233](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39311359233)
- [Numeric-only real model evidence artifact 12216651101](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39311359233/artifacts/12216651101)
- Model original release ZIP SHA-256: `922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08`.
- Original vendor CT sample archive SHA-256: `3bc452580051dbea0f67caa52c4eb09c75eafdde9e8e7ff60c3a143ec94dce1f`.
- True inference `raidionicsseg==1.5.2`, ONNX CPU: **20.01 seconds**, peak original main process RSS **3,999,629,312 bytes (~3.73 GiB)**, **81,490** positive label voxels, computed output mask volume **233.145 mL**, native affine and CT image shape consistent.
- **NOT** an expert-positive LyNoS CT, lesion-level sensitivity, oncologic staging or any clinically validated accuracy number. Output label voxel volume does not establish true pathologic node burden.
- Original legacy TF1.14 model archive also successfully downloaded and checksum verified on [run 39309786383](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39309786383), but LyNoS Pat1 CT exceeded the research runner 200M voxel limit; no original TF forward, no independent expert Dice from that run.

**Promotion condition:** next independent manually annotated positive CT with provenance, verify native affine, calculate voxel TP/FP/FN/Dice plus connected lesion recall and FP/CT; only then discuss clinic-oriented sensitivity. Current research evidence remains restricted to one vendor sample. Never copy the ONNX model into web browser bundle or onto the 8GB Mac by default; use optional isolated CPU worker after resource measurements.

## Переход к настоящим весам Bouget · отдельная CPU-проверка

Добавлен `scripts/bouget-official-checkpoint-preflight.py` и
[GitHub Actions `bouget-mediastinal-cpu-weights.yml`](../.github/workflows/bouget-mediastinal-cpu-weights.yml).
Они используют **единственный публичный адрес оригинала, объявленный автором**:
Google Drive ID `1DBIl8JyXEo6YdM9uNyo3vrv5T2WsYSXT` и MD5
`434775bebd64910e01f4198eab251666`, проверяют точное совпадение
архива, ограничения размера/архивных имён, пересчитывают SHA-256 каждого
контрольного файла. Вывод содержит только идентификатор оригинальной
модели, размеры и криптографические дайджесты — ни КТ, ни UID.

В PR запускаются только синтетические offline-тесты. После **слияния в main**
производится один автоматический запуск скачивания оригинального архива
на GitHub Actions CPU: оригинальная MD5, SHA-256 моделей, ограничение объёма
и числовой отчёт. Если Google Drive блокирует скачивание или не позволяет
проверить целостность, CI явно покажет отказ, а модель останется неподключённой.
Повторную загрузку можно отдельно запустить через `workflow_dispatch` с
`fetch_official_weights=true`. Никакие КТ при загрузке не передаются.

**Контроль честности:** такой запуск **не является** инференсом. В
оригинальном репозитории TensorFlow 1.14, его зависимости несовместимы с
современным Python/Mac M1 без отдельного исследовательского окружения.
Для настоящего forward потребуются проверенные веса, рабочий изолированный
CPU TensorFlow-1.14-контейнер с лимитом ресурсов и разрешённая CT из LyNoS
с отдельной экспертной маской. Сам файл набора имеется на
https://huggingface.co/datasets/andreped/LyNoS
(15 КТ плюс экспертные маски узлов), но обучение Bouget тоже происходило на
родственном наборе, так что **независимый holdout не доказан**.
Только после реального оригинального forward, проверки source geometry,
численной маски и памяти можно подключать результаты детектора в Opus.

