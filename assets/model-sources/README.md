# Exact model-source bundle

The `.glb.gz` files in this directory are losslessly gzip-compressed copies of the exact original GLBs supplied alongside the Studio ZIP. `npm ci` decompresses them byte-for-byte into `assets/source/` and runs the original offline rigging/optimization pipeline. These are source inputs, not substitute models.

`sportbike_eriklys.glb` is intentionally absent: it is referenced by the Studio ZIP's processor but was not present in the shared Drive folder. See the root README before adding that vehicle.
