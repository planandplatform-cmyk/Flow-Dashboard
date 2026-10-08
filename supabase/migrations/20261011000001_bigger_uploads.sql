-- Screenshots and report PDFs now go straight from the browser to Storage
-- (not through the app server), so files can be larger: 25 MB each.
update storage.buckets set file_size_limit = 26214400 where id = 'uploads';
