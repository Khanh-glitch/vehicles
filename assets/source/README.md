# Optional model-generation inputs

The studio ships the prepared, local runtime GLBs under `public/models/`; normal installation and app startup do not need this directory.

To rerun the offline rigging/optimization pipeline, place the exact original input files here:

- `honda_super_cub.glb`
- `motorbike_-_honda_cg_125.glb`
- `motorcycle_harley_davidson_fat_boy_inspired.glb`
- `harledson_XYN.glb`
- `sportbike_eriklys.glb` (not present in the supplied Google Drive folder)

Then run `npm run models:build -- <vehicle-id>` for the model(s) you supplied. The generator deliberately skips missing inputs rather than substituting a different model. See the root README for the source-availability note and exact vehicle IDs.
