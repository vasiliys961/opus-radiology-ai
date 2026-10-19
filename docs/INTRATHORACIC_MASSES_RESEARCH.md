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


## Original Bouget/LyNoS **real CPU inference attempt** (research branch)

Source: publisher GitHub revision `f1eedfe117da9fe5377daa3b2e72fc268e5c7867`,
original `models.zip` Google Drive file ID `1DBIl8JyXEo6YdM9uNyo3vrv5T2WsYSXT`
(author `setup.py`; MD5 `434775bebd64910e01f4198eab251666`).
Publisher TensorFlow 1.14 is **not installed in Opus, browser, Mac or main
Next.js server**. Research runner attempts original publisher CPU-only Docker
`dbouget/ct_mediastinal_structures_segmentation:v1`, `UNet-SW32` plus
the original `CT_Lungs` preprocessing model, with `--network none`,
2 CPU cores, 5.5 GiB RAM limit, time bounds and process caps. Dynamic Docker
image digest and extracted original checkpoint SHA256 are recorded if a real
run succeeds.

Independent **expert-positive public research CT pair**:
`LyNoS` (Zenodo 10102261, `Pat1` original `pat1_data.nii.gz` plus original
`pat1_labels_LymphNodes.nii.gz`). Full publisher archive is approximately
2.9 GB, but runner requires HTTP Range and selects only these two entries
via `remotezip`. If range support is blocked, STOP without pulling 2.9GB.
Individual decompressed entry, source voxel count, overall free RAM and
disk use have caps. NIfTI original expert-prediction spatial affine equality
is required before voxel TP/FP/FN/Dice; no shifting/fake resampling to force
a metric. The original expert set was published as a benchmark, but patient-
level training independence has not yet been independently audited.

Executable source:
`scripts/real-mediastinal-lynos-ct-cpu.py` and
`.github/workflows/real-mediastinal-lynos-original-cpu.yml`.
**The existence of this workflow does not mean model download, model forward,
positive mask Dice or sensitivity has succeeded.** Only a CI run with the
real numeric JSON artifact and original publisher hashes qualifies.
If Google Drive original archive, original Docker image or partial Zenodo
reads become unavailable, the job must fail transparently; fake/random
checkpoints, unverified public images and synthetic metrics are forbidden.
Only numerical artifacts may leave the workflow; original images and model
weights are purged at job end. No patient CT or cloud LLM calls.
