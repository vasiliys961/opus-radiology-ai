# PATH-ICH-04 — один подлинный случай SAMIHS → экспертная маска

**Статус: единый исполнитель реализован. Подтверждённых запусков предобученной SAMIHS по публичному случаю с экспертной маской пока НЕТ.**

Путь `scripts/run-ich-first-real-case.py` сводит четыре уже существующих реальных вычислительных шага в один **без замены** инференса моделированием, повторением срезов или самодельной экспертной разметкой:

1. Сверить SHA-256 настоящей исходной КТ и эталонной маски, наличие аудированной модели, явную исследовательскую правомерность и внешний Linux CUDA.
2. Запустить штатный `scripts/run-samihs-ich-public.py` на **полном исходном 3D NIfTI**, из проверенного предобученного checkpoint и поставляемого с ним `segment_ich.py`. Обязательный guard GPU VRAM >=12GiB и batch <=8 остаётся действующим.
3. `scripts/ich-expert-component-contact.py`: получить независимый Dice, HD95 и совпадения 3D-компонент с настоящей экспертной маской.
4. `scripts/ich-native-slice-evidence.py`: получить покадровое распределение TP/FP/FN и пропущенные экспертные уровни.
5. Сверить модель/вход/маску/эталон по SHA, 3D метрики между двумя независимыми вычислениями и полноту всех JSON. **Только после этого** написать `opus-ich-first-public-case-complete.json`.

```bash
python scripts/run-ich-first-real-case.py \
  --model-dir /research/audited-samihs \
  --input /research/authorized-head-ct.nii.gz \
  --expert-mask /research/authorized-expert-mask.nii.gz \
  --output-dir /research/ich-first-real-results \
  --source-sha256 <REAL_CT_SHA256> \
  --reference-sha256 <REAL_EXPERT_SHA256> \
  --checkpoint-sha256 <REAL_SAMIHS_WEIGHTS_SHA256> \
  --wrapper-sha256 <AUDITED_SEGMENT_ICH_PY_SHA256> \
  --dataset-citation-url https://example.org/original-authorized-dataset \
  --slice-axis 2 --reference-label 1 \
  --batch-size 1 --threshold 0.5 \
  --max-model-seconds 3600 \
  --rights-attested --upstream-model-audited \
  --public-research-authorization PUBLIC-ICH-FULL-CASE
```

Запуск только на авторизованном **внешнем GPU Linux** с локально установленными Torch CUDA, nibabel, numpy, scipy и полными зависимостями SAMIHS. Скрипт не устанавливает пакеты, не скачивает данные/веса, не запускает модель на Mac и не отправляет данные в Hugging Face/API/GitHub. Никаких платных GPU он сам не арендует. При ошибке он оставляет только частичные локальные артефакты **без** `opus-ich-first-public-case-complete.json`.

**Важно:** отметки `--rights-attested` и `--upstream-model-audited` являются утверждениями оператора, не юридической верификацией OpenAI/Opus. Правила INSTANCE2022 по-прежнему ограничивают использование данным соревнованием и требуют подписанного соглашения, даже при открытом скачивании; нельзя выдавать этот набор за автоматически разрешённый. PhysioNet CT-ICH v1.3.1 ограничен соглашением, старый v1.2.0 недоступен для новых скачиваний. Другие наборы (например, Zenodo Seg-CQ500 или SAH) также нуждаются в отдельной проверке условий лицензирования как исходной КТ, так и самой экспертной разметки.

Сохранить на сервере исходную КТ и экспертную маску для врачебной проверки; **не** коммитить ни пиксели, ни маски, ни идентификаторы пациента в репозиторий. Признаки уровня case из полученного JSON не дают клинической чувствительности/специфичности, доказанного held-out качества, идентификации типа кровоизлияния или исходного DICOM SOP.

Финальный `opus-ich-first-public-case-complete.json` является воспроизводимым техническим следом выполненной цепочки, но **не** независимой гарантией аудита авторства публичной разметки, весов модели или корректности диагноза.
