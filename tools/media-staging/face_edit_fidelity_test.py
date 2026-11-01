"""Real semantic tests for original-image preservation acceptance.
Synthetic pixels only, never use another person's face as a test fixture.
"""
import unittest
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw
from face_edit_fidelity import check_scope,make_mask

class FaceRegionQATests(unittest.TestCase):
    def setUp(self):
        self.original=Image.new('RGB',(128,100),(44,65,97))
        draw=ImageDraw.Draw(self.original)
        for i in range(0,128,7):draw.line([(i,0),(i,99)],fill=(120,70,35))
        self.poly=[[40,15],[88,15],[88,78],[40,78]]
    def changed(self):
        pic=self.original.copy()
        ImageDraw.Draw(pic).rectangle([56,29,71,60],fill=(240,210,191))
        return pic
    def test_unchanged_source_is_not_a_fangyuan_edit(self):
        result=check_scope(self.original,self.original,self.poly)
        self.assertFalse(result['scope_pass'])
        self.assertTrue(result['background_preserved'])
        self.assertFalse(result['face_region_changed'])
    def test_only_editing_selected_region_passes_geometry_gate(self):
        result=check_scope(self.original,self.changed(),self.poly)
        self.assertTrue(result['scope_pass'])
        self.assertTrue(result['face_region_changed'])
        self.assertEqual(result['outside_avg_rgb_delta'],0.0)
    def test_redrawing_entire_frame_fails(self):
        image=Image.new('RGB',(128,100),(230,200,160))
        result=check_scope(self.original,image,self.poly)
        self.assertFalse(result['scope_pass'])
        self.assertFalse(result['background_preserved'])
    def test_moving_hat_hand_or_background_fails(self):
        image=self.changed()
        ImageDraw.Draw(image).rectangle([5,5,30,40],fill=(0,0,0))
        result=check_scope(self.original,image,self.poly)
        self.assertFalse(result['scope_pass'])
    def test_resize_fails(self):
        result=check_scope(self.original,self.original.resize((120,100)),self.poly)
        self.assertFalse(result['scope_pass'])
        self.assertEqual(result['reason'],'changed_canvas_dimensions')
    def test_mask_covers_only_intended_zone(self):
        mask=make_mask(self.original.size,self.poly)
        self.assertTrue(mask[50,65])
        self.assertFalse(mask[0,0])
        self.assertLess(float(mask.mean()),0.5)

if __name__=='__main__':
    unittest.main(verbosity=2)
