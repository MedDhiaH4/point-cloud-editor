import torch
import os
import sys
import numpy as np
import cv2
import base64
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

# ==========================================
# PHASE 1: GLOBAL OVERRIDES & SECURITY
# ==========================================
def patched_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return torch.serialization.load(*args, **kwargs)
torch.load = patched_load

# ==========================================
# PHASE 2: REPOSITORY PATH ALIGNMENT
# ==========================================
repo_root = r"C:\Users\jeols\Desktop\thesis\sam3"
sys.path.insert(0, repo_root)
sys.path.insert(0, os.path.join(repo_root, "sam3"))

try:
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_video_predictor import Sam3VideoPredictor
    print("✅ PHASE 2 COMPLETE: SAM 3.1 Modules Imported.")
except ImportError as e:
    print(f"❌ PHASE 2 FAILED: {e}")
    sys.exit(1)

# ==========================================
# PHASE 3: MODEL & PREDICTOR INITIALIZATION
# ==========================================
app = FastAPI(title="SAM 3.1 Multiplex Thesis Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

device = 'cuda' if torch.cuda.is_available() else 'cpu'
checkpoint = r"C:\Users\jeols\Desktop\thesis\point-cloud-segmentation\sam3.1_multiplex.pt"

print(f"⚙️ PHASE 3: Booting SAM 3.1 on {device}...")

try:
    # 1. Build Image Model
    sam3_model = build_sam3_image_model(
        bpe_path=None, 
        device=device,
        checkpoint_path=checkpoint,
        load_from_HF=False
    )
    
    # 2. 🎯 THE DEEP PROXY FIX
    predictor = Sam3VideoPredictor.__new__(Sam3VideoPredictor)
    predictor.model = sam3_model
    predictor.device = torch.device(device)

    # 🕵️‍♂️ RECURSIVE FUNCTION DISCOVERY
    # This checks the model, and all its internal sub-modules for the video logic
    target_fns = ["init_state", "propagate_in_video", "add_new_points_or_box", "reset_state"]
    found_fns = {fn: None for fn in target_fns}

    def find_logic(obj):
        for attr in dir(obj):
            for fn in target_fns:
                if found_fns[fn] is None and attr == fn:
                    found_fns[fn] = getattr(obj, attr)
            # Short circuit if all found
            if all(v is not None for v in found_fns.values()): return

    # Search the model and common sub-module names
    find_logic(sam3_model)
    if None in found_fns.values():
        for sub in ["tracker", "predictor", "engine", "memory_attention"]:
            if hasattr(sam3_model, sub):
                find_logic(getattr(sam3_model, sub))

    # Manually attach found functions
    predictor.init_state = found_fns["init_state"]
    predictor.propagate_in_video = found_fns["propagate_in_video"]
    predictor.add_new_points_or_box = found_fns["add_new_points_or_box"]
    predictor.reset_state = found_fns["reset_state"]

    if predictor.init_state is None:
        # One last check: Did Meta rename it to 'init_inference_state'?
        if hasattr(sam3_model, "init_inference_state"):
            predictor.init_state = sam3_model.init_inference_state
        else:
            raise RuntimeError("CRITICAL: SAM 3.1 logic found, but 'init_state' is missing from all modules.")

    print("🚀 PHASE 3 COMPLETE: Predictor linked via Deep Discovery.")

except Exception as e:
    print(f"❌ PHASE 3 FAILED: {e}")
    sys.exit(1)

# ==========================================
# PHASE 4: API ENDPOINT LOGIC
# ==========================================
class OrbitFrame(BaseModel):
    image: str 

class OrbitPayload(BaseModel):
    frames: list[OrbitFrame]
    points: list[list[int]]
    labels: list[int]

@app.post("/segment_video_orbit")
def segment_video_orbit(req: OrbitPayload):
    print(f"📥 PHASE 4: Received {len(req.frames)} frames. Starting segmentation...")
    
    try:
        frames_in_ram = []
        for f in req.frames:
            encoded_data = f.image.split(',')[1] if ',' in f.image else f.image
            nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
            frames_in_ram.append(cv2.cvtColor(cv2.imdecode(nparr, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB))

        # Use the proxy-linked functions
        inference_state = predictor.init_state(images=frames_in_ram)
        
        predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx=0,
            obj_id=1,
            points=np.array(req.points, dtype=np.float32),
            labels=np.array(req.labels, dtype=np.int32),
        )

        base64_masks = []
        for _, _, out_mask_logits in predictor.propagate_in_video(inference_state):
            # Convert logits to binary mask
            mask = (out_mask_logits[0].cpu().numpy() > 0.0).astype(np.uint8) * 255
            _, buffer = cv2.imencode('.png', np.squeeze(mask))
            base64_masks.append(base64.b64encode(buffer).decode('utf-8'))

        predictor.reset_state(inference_state)
        torch.cuda.empty_cache()
        
        print("✅ PHASE 4 COMPLETE: Masks generated.")
        return {"status": "success", "masks": base64_masks}

    except Exception as e:
        print(f"❌ PHASE 4 FAILED: {e}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)