"""Offline semantic clothing masks with FASHN's 18-class SegFormer parser.

Preprocessing follows the official parser (INTER_AREA, ImageNet RGB, 384x576).
The pretrained model retains NVIDIA SegFormer's noncommercial license.
This module does not infer measurements or whether a garment physically fits.
"""
import gc
from pathlib import Path


class MaskInputError(ValueError):
    """An input rejection with a stable code; callers must whitelist messages."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def mask_from_labels(labels, category, *, return_regions=False):
    """Build a conservative edit mask from the parser's 18-class label map.

    This pure path does not import or run a model. Multiple-person checks are
    semantic heuristics, not an identity detector. Standing frontal poses are
    required. Side-arm sleeve boundaries may be regenerated, while crossed arms
    remain protected. This is a semantic heuristic, not 3D occlusion estimation.
    """
    import numpy as np
    from scipy import ndimage

    labels = np.asarray(labels)
    if labels.ndim != 2 or labels.size == 0 or not np.issubdtype(labels.dtype, np.integer):
        raise ValueError('Expected a nonempty integer semantic label map')
    if labels.min() < 0 or labels.max() > 17:
        raise ValueError('Semantic label IDs must be between 0 and 17')
    if category not in ('tops', 'bottoms', 'one-pieces'):
        raise ValueError('Unsupported garment category')

    scale = labels.size / (576 * 384)
    min_body = max(16, round(3500 * scale))
    min_region = max(4, round(600 * scale))
    min_face = max(4, round(64 * scale))
    structure = np.ones((3, 3), dtype=bool)

    # Glasses can separate one face into upper/lower parts. Include their label
    # before counting significant faces; never merge faces through shared hair.
    faces = ndimage.binary_closing(np.isin(labels, [1, 11]), structure=structure,
                                   iterations=2)
    face_components, _ = ndimage.label(faces, structure=structure)
    face_areas = np.bincount(face_components[labels == 1],
                             minlength=int(face_components.max()) + 1)
    face_areas[0] = 0
    if np.count_nonzero(face_areas >= min_face) >= 2:
        raise MaskInputError('MULTIPLE_PEOPLE', '检测到多个人物，请使用清晰的单人正面照片。')

    components, count = ndimage.label(labels != 0, structure=structure)
    areas = np.bincount(components.ravel(), minlength=count + 1)
    areas[0] = 0
    if count == 0 or areas.max() < min_body:
        raise MaskInputError('PERSON_NOT_FOUND', '没有可靠的人物轮廓，请选择清晰单人正面照。')

    # Reject a second independent body even when its face is cropped/turned.
    # Small detached hands/accessories are not independently counted as people.
    person_components = []
    for component in np.flatnonzero(areas >= min_body):
        values = labels[components == component]
        upper = np.count_nonzero(np.isin(values, [3, 4, 10, 16]))
        lower = np.count_nonzero(np.isin(values, [5, 6, 14]))
        face = np.count_nonzero(values == 1)
        if ((upper >= min_region and lower >= min_region)
                or (face >= min_face and upper + lower >= min_region)):
            person_components.append(int(component))
    if len(person_components) >= 2:
        raise MaskInputError('MULTIPLE_PEOPLE', '检测到独立的人物轮廓，请使用单人照片。')
    selected = person_components[0] if person_components else int(areas.argmax())
    body = components == selected

    if category == 'tops' and np.count_nonzero((labels == 3) & body) < min_region:
        if np.count_nonzero((labels == 4) & body) >= min_region:
            raise MaskInputError('UNSUPPORTED_SOURCE_GARMENT',
                                 '原图穿着连衣裙，请选择连体装类别，或换用穿上衣的照片。')

    keep = {'tops': [3, 10], 'bottoms': [5, 6, 7],
            'one-pieces': [3, 4, 5, 6, 7, 10]}[category]
    region = np.isin(labels, keep) & body
    if np.count_nonzero(region) < min_region:
        raise MaskInputError('REGION_NOT_FOUND', '目标服装区域不够清晰，请更换正面人物照片。')

    if category == 'one-pieces':
        # Include bare waist/legs and the horizontal gap between the legs so a
        # dress is not confined to the old top/shorts. Arms/hands/head/feet are
        # excluded again after all expansion. No pose or garment-length inference
        # is claimed: crossed limbs, seated poses and wide stances are unsuitable.
        envelope = np.isin(labels, [3, 4, 5, 6, 7, 14, 16]) & body
        for row in np.flatnonzero(envelope.any(axis=1)):
            columns = np.flatnonzero(envelope[row])
            region[row, columns[0]:columns[-1] + 1] = True

    # A hard exclusion at the old sleeve edge leaves a pasted skin strip when
    # the new garment has shorter sleeves. Permit the nearby part of side arms
    # to blend with generated skin; protect arms crossing the torso completely.
    arm_protection = labels == 12
    if category in ('tops', 'one-pieces'):
        torso_y, torso_x = np.where(np.isin(labels, [3, 4, 10, 16]) & body)
        if torso_x.size:
            left, right = np.quantile(torso_x, [.15, .85])
            arm_parts, arm_count = ndimage.label(arm_protection, structure=structure)
            for part in range(1, arm_count + 1):
                ay, ax = np.where(arm_parts == part)
                if ax.size and not left <= np.median(ax) <= right:
                    arm_protection[arm_parts == part] = False
    region = ndimage.binary_fill_holes(region)
    region = ndimage.binary_closing(region, iterations=3)
    region = ndimage.binary_dilation(region, iterations=7)
    protect = [1, 2, 8, 9, 11, 13, 15, 17]
    if category == 'tops':
        protect += [4, 5, 6, 7, 14]
    elif category == 'bottoms':
        protect += [3, 4, 10, 16]
    forbidden = np.isin(labels, protect) | arm_protection | ((labels != 0) & ~body)
    region &= ~forbidden
    region = ndimage.gaussian_filter(region.astype(np.float32), sigma=1.5) > .18
    # Dilation/smoothing must never re-enter another foreground component.
    region &= ~forbidden
    return (region, forbidden) if return_regions else region


def mask_images_from_labels(labels, category, size):
    """Return the editable mask and original-background map at image size."""
    import numpy as np
    from PIL import Image

    region, protected = mask_from_labels(labels, category, return_regions=True)
    mask = Image.fromarray(region.astype(np.uint8) * 255).resize(size, Image.Resampling.NEAREST)
    background = Image.fromarray((np.asarray(labels) == 0).astype(np.uint8) * 255)
    info = {'original_background': background.resize(size, Image.Resampling.NEAREST),
            'protected': Image.fromarray(protected.astype(np.uint8) * 255).resize(size, Image.Resampling.NEAREST),
            'category': category, 'person_detection': 'semantic_heuristic'}
    return mask, info


def inward_feather(mask, radius):
    """Feather only inside the permitted edit region; outside alpha stays zero."""
    import numpy as np
    from PIL import Image, ImageFilter

    hard = np.asarray(mask.convert('L'))
    allowed = Image.fromarray((hard > 0).astype(np.uint8) * 255)
    blurred = np.asarray(allowed.filter(ImageFilter.GaussianBlur(max(0, radius))))
    return Image.fromarray(np.minimum(blurred, hard))


def composite_mask(mask, radius, protected=None):
    """Soften clothing edges but keep explicitly protected pixels unchanged.

    Hard clipping at every mask edge made sleeve/background rectangles visible
    in actual inference. A narrow transition is allowed around the garment;
    face, hair, hands, occluding arms and unrelated clothes remain protected.
    """
    import numpy as np
    from PIL import Image, ImageFilter
    values = np.asarray(mask.convert('L').filter(ImageFilter.GaussianBlur(radius))).copy()
    if protected is not None:
        values[np.asarray(protected) > 127] = 0
    return Image.fromarray(values)


def garment_mask(person, category, model_dir, diagnostics=None, *, return_info=False):
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from transformers import SegformerForSemanticSegmentation
    parser=SegformerForSemanticSegmentation.from_pretrained(Path(model_dir)/'parser',local_files_only=True,use_safetensors=True).eval()
    pixels=cv2.resize(np.asarray(person),(384,576),interpolation=cv2.INTER_AREA).astype(np.float32)/255
    pixels=(pixels-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
    with torch.inference_mode():
        logits=parser(pixel_values=torch.from_numpy(pixels.transpose(2,0,1).copy())[None]).logits
        # Keep mask processing bounded; nearest-neighbour upscale at the end.
        labels=torch.nn.functional.interpolate(logits,size=(576,384),mode='bilinear',align_corners=False).argmax(1)[0].numpy()
    del parser,logits,pixels;gc.collect()
    mask,info=mask_images_from_labels(labels,category,person.size)
    if diagnostics:
        mask.save(Path(diagnostics)/'mask.png')
        palette=np.array([[0,0,0],[245,199,166],[78,58,48],[76,147,220],[178,90,180],[67,170,140],[88,99,166],[200,160,80],[179,108,60],[171,141,212],[106,174,198],[82,71,103],[233,184,149],[229,167,145],[222,176,146],[190,200,210],[230,191,170],[255,218,80]],dtype=np.uint8)
        Image.fromarray(palette[labels]).save(Path(diagnostics)/'parsing.png')
    return (mask,info) if return_info else mask
