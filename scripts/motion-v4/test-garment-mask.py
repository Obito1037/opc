"""Regression counterexamples against real pure mask functions; no ML imports."""
from pathlib import Path
import hashlib
import json
import sys
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/vton-v4'))
from garment_mask import MaskInputError, mask_from_labels, mask_images_from_labels, inward_feather, composite_mask


def standing():
    labels = np.zeros((576, 384), dtype=np.uint8)
    labels[45:85, 170:210] = 1
    labels[85:300, 130:254] = 3
    labels[300:470, 140:244] = 6
    labels[470:510, 140:244] = 15
    return labels


def two_people(touching=False, faces=True):
    labels = np.zeros((576, 384), dtype=np.uint8)
    for x in (60, 230):
        if faces:
            labels[55:100, x + 15:x + 55] = 1
        labels[100:250, x:x + 70] = 3
        labels[250:450, x + 5:x + 65] = 6
    if touching:
        labels[200:211, 125:235] = 3
    return labels


class GarmentMaskTests(unittest.TestCase):
    def rejected(self, labels, category, code):
        with self.assertRaises(MaskInputError) as caught:
            mask_from_labels(labels, category)
        self.assertEqual(caught.exception.code, code)

    def test_empty_person_rejected(self):
        self.rejected(np.zeros((576, 384), np.uint8), 'tops', 'PERSON_NOT_FOUND')

    def test_category_with_no_region_rejected(self):
        labels = standing()
        labels[labels == 6] = 14
        self.rejected(labels, 'bottoms', 'REGION_NOT_FOUND')

    def test_dress_only_is_not_a_top(self):
        labels = standing()
        labels[85:470, 130:254] = 4
        self.rejected(labels, 'tops', 'UNSUPPORTED_SOURCE_GARMENT')
        self.assertTrue(mask_from_labels(labels, 'one-pieces')[400, 190])

    def test_touching_people_with_two_faces_rejected(self):
        self.rejected(two_people(touching=True), 'tops', 'MULTIPLE_PEOPLE')

    def test_two_independent_bodies_without_faces_rejected(self):
        self.rejected(two_people(faces=False), 'tops', 'MULTIPLE_PEOPLE')

    def test_two_independent_people_rejected(self):
        self.rejected(two_people(), 'one-pieces', 'MULTIPLE_PEOPLE')

    def test_one_face_split_by_glasses_is_not_two_people(self):
        labels = standing()
        labels[60:69, 170:210] = 11
        region = mask_from_labels(labels, 'tops')
        self.assertTrue(region[100, 190])
        self.assertFalse(region[np.isin(labels, [1, 11])].any())

    def test_dilation_cannot_enter_detached_foreground(self):
        labels = standing()
        # This narrow cropped fragment is too small to identify as a second
        # person. It is still foreground and must never be silently repainted.
        labels[130:240, 257:265] = 3
        region = mask_from_labels(labels, 'tops')
        self.assertFalse(region[130:240, 257:265].any())
        self.assertTrue(region[160:210, 254:257].any())

    def test_tops_and_bottoms_keep_crossed_bare_arms_and_hands(self):
        labels = standing()
        labels[140:200, 170:200] = 13
        labels[210:240, 160:220] = 12
        labels[340:365, 160:220] = 12
        for category in ('tops', 'bottoms'):
            with self.subTest(category=category):
                region = mask_from_labels(labels, category)
                self.assertFalse(region[np.isin(labels, [1, 12, 13, 15])].any())
                self.assertTrue(region.any())

    def test_onepiece_fills_waist_bare_legs_and_between_legs(self):
        labels = standing()
        labels[210:240, 130:254] = 16
        labels[240:320, 130:254] = 6
        labels[320:470, 130:254] = 0
        labels[320:470, 140:174] = 14
        labels[320:470, 210:244] = 14
        labels[140:220, 175:195] = 12
        labels[220:240, 175:195] = 13
        region = mask_from_labels(labels, 'one-pieces')
        self.assertTrue(region[221:230, 150:170].all())
        self.assertTrue(region[380:430, 145:169].all())
        self.assertTrue(region[380:430, 180:204].all())
        self.assertFalse(region[np.isin(labels, [1, 12, 13, 15])].any())

    def test_top_does_not_erase_existing_dress_hem_or_pants(self):
        labels = standing()
        labels[300:470, 140:244] = 4
        region = mask_from_labels(labels, 'tops')
        self.assertTrue(region[150:200, 150:234].all())
        self.assertFalse(region[labels == 4].any())

    def test_feather_and_actual_composite_preserve_every_forbidden_pixel(self):
        labels = standing()
        labels[140:200, 170:200] = 13
        labels[210:240, 160:220] = 12
        region = mask_from_labels(labels, 'tops')
        hard = Image.fromarray(region.astype(np.uint8) * 255)
        alpha = inward_feather(hard, 576 / 450)
        values = np.asarray(alpha)
        self.assertFalse(values[~region].any())
        self.assertTrue(((values > 0) & (values < 255) & region).any())
        source = np.zeros((576, 384, 3), dtype=np.uint8)
        source[:] = (17, 81, 123)
        result = np.asarray(Image.composite(Image.new('RGB', hard.size, 'white'),
                                           Image.fromarray(source), alpha))
        np.testing.assert_array_equal(result[~region], source[~region])
        self.assertTrue((result[region] != source[region]).any())

    def test_background_info_is_original_labels_not_editable_mask(self):
        labels = standing()
        mask, info = mask_images_from_labels(labels, 'tops', (768, 1152))
        background = info['original_background']
        self.assertEqual(mask.size, (768, 1152))
        self.assertEqual(background.mode, 'L')
        expected = ((labels == 0).astype(np.uint8) * 255).repeat(2, 0).repeat(2, 1)
        np.testing.assert_array_equal(np.asarray(background), expected)
        self.assertFalse('torch' in sys.modules)
        self.assertFalse('transformers' in sys.modules)

    def test_soft_composite_keeps_head_hands_and_other_clothes_exact(self):
        labels = standing()
        labels[150:180, 160:190] = 13
        labels[210:240, 160:220] = 12
        mask, info = mask_images_from_labels(labels, 'tops', (384, 576))
        values = np.asarray(composite_mask(mask, 3, info['protected']))
        protected = np.isin(labels, [1, 12, 13, 6, 15])
        self.assertFalse(values[protected].any())
        self.assertTrue(((values > 0) & (values < 255) & (labels == 0)).any())
        self.assertFalse(values[520:].any())

    def test_side_arm_boundary_allows_skin_transition_but_not_hand(self):
        labels = standing()
        labels[170:300, 115:130] = 12
        labels[300:330, 115:130] = 13
        region = mask_from_labels(labels, 'tops')
        self.assertTrue(region[180:250, 126:130].any())
        self.assertFalse(region[labels == 13].any())


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(GarmentMaskTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    source = ROOT / 'scripts/vton-v4/garment_mask.py'
    report = {'tests': result.testsRun, 'failures': len(result.failures),
              'errors': len(result.errors), 'passed': result.wasSuccessful(),
              'method': 'Synthetic label and composite assertions call actual pure implementation.',
              'modelInference': False, 'torchImported': 'torch' in sys.modules,
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'limits': 'Does not measure semantic parser accuracy, generated garment quality or arbitrary pose reliability.'}
    target = ROOT / 'test-results/motion-v4/garment-mask-regression.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
    sys.exit(0 if result.wasSuccessful() else 1)
