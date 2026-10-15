"""Training-only per-class positive weighting for sparse knee MRI labels."""
from rsna_knee import LABELS, extract_labels

def positive_weights(train_rows,max_weight=5.0):
    if max_weight<1:raise ValueError("max_weight must be >=1")
    positive=[0]*len(LABELS);negative=[0]*len(LABELS)
    for row in train_rows:
        values,known=extract_labels(row)
        for j in range(len(LABELS)):
            if not known[j]:continue
            if values[j]==1:positive[j]+=1
            else:negative[j]+=1
    weights=[]
    for p,n in zip(positive,negative):
        weights.append(min(max_weight,max(1.,n/p)) if p and n else 1.)
    return weights,{"positives":positive,"negatives":negative,
                    "unknown_or_unevaluable":[p==0 or n==0 for p,n in zip(positive,negative)]}
