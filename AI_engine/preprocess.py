import cv2

def preprocess(path):
    img = cv2.imread(path)

    if img is None:
        print(f"이미지 로드 실패: {path}")
        return None

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img