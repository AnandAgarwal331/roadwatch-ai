-- seeded_places has been empty since the Supabase cutover: the FastAPI
-- backend's backend/app/seed.py populated it (a synthetic Bengaluru catalogue
-- of hospitals/schools/emergency services/intersections/bus stops), but that
-- script was never ported - only the table's schema was. Every complaint's
-- location-risk score has silently been scoring "no nearby facilities" for
-- everyone since the migration, regardless of where the report actually is.
--
-- This restores that Bengaluru catalogue (minus the seed script's randomly
-- jittered "satellite" bus stops, which added visual noise, not real
-- locations worth keeping), and adds one real entry: Shivshakti Hospital,
-- 80 Feet Road, Kota, reported by a user whose pothole report near it wasn't
-- flagging a nearby hospital. Its coordinates are the user-supplied report
-- location (the hospital's own exact pin wasn't available) - close enough to
-- register within the 500m detection radius; correct it if a precise pin
-- turns up later.

insert into public.seeded_places (place_type, name, latitude, longitude, city) values
  ('HOSPITAL', 'St. Martha''s Hospital', 12.9612, 77.5905, 'Bengaluru'),
  ('HOSPITAL', 'Manipal Hospital, Old Airport Road', 12.9584, 77.6494, 'Bengaluru'),
  ('HOSPITAL', 'Sagar Hospital, Banashankari', 12.9128, 77.5686, 'Bengaluru'),
  ('HOSPITAL', 'Sakra World Hospital, Bellandur', 12.9273, 77.6779, 'Bengaluru'),
  ('HOSPITAL', 'Columbia Asia, Whitefield', 12.9705, 77.7482, 'Bengaluru'),
  ('SCHOOL', 'National Public School, Indiranagar', 12.9731, 77.6395, 'Bengaluru'),
  ('SCHOOL', 'Bishop Cotton Boys'' School', 12.9640, 77.5990, 'Bengaluru'),
  ('SCHOOL', 'Delhi Public School, Sarjapur', 12.9105, 77.6802, 'Bengaluru'),
  ('SCHOOL', 'Vidya Niketan School, Jayanagar', 12.9262, 77.5851, 'Bengaluru'),
  ('SCHOOL', 'Ryan International, Kundalahalli', 12.9682, 77.7148, 'Bengaluru'),
  ('SCHOOL', 'Kendriya Vidyalaya, Malleshwaram', 13.0035, 77.5712, 'Bengaluru'),
  ('EMERGENCY_SERVICE', 'Indiranagar Police Station', 12.9749, 77.6415, 'Bengaluru'),
  ('EMERGENCY_SERVICE', 'Koramangala Fire Station', 12.9338, 77.6252, 'Bengaluru'),
  ('EMERGENCY_SERVICE', 'Whitefield Police Station', 12.9691, 77.7495, 'Bengaluru'),
  ('EMERGENCY_SERVICE', 'Banashankari Fire Station', 12.9155, 77.5735, 'Bengaluru'),
  ('MAJOR_INTERSECTION', 'Silk Board Junction', 12.9172, 77.6229, 'Bengaluru'),
  ('MAJOR_INTERSECTION', 'Marathahalli Junction', 12.9562, 77.7016, 'Bengaluru'),
  ('MAJOR_INTERSECTION', 'Richmond Circle', 12.9627, 77.5972, 'Bengaluru'),
  ('MAJOR_INTERSECTION', 'Hebbal Flyover', 13.0358, 77.5912, 'Bengaluru'),
  ('MAJOR_INTERSECTION', 'Bellandur Gate', 12.9256, 77.6757, 'Bengaluru'),
  ('BUS_STOP', 'Indiranagar Metro Bus Stop', 12.9784, 77.6390, 'Bengaluru'),
  ('BUS_STOP', 'Koramangala Water Tank Stop', 12.9349, 77.6270, 'Bengaluru'),
  ('BUS_STOP', 'HSR BDA Complex Stop', 12.9110, 77.6420, 'Bengaluru'),
  ('BUS_STOP', 'Marathahalli Bridge Stop', 12.9575, 77.7005, 'Bengaluru'),
  ('BUS_STOP', 'Jayanagar 4th Block Stop', 12.9256, 77.5842, 'Bengaluru'),
  ('BUS_STOP', 'Bellandur Gate Stop', 12.9262, 77.6768, 'Bengaluru'),
  ('BUS_STOP', 'Whitefield TTMC Stop', 12.9700, 77.7492, 'Bengaluru'),
  ('BUS_STOP', 'Yeshwanthpur TTMC Stop', 13.0235, 77.5515, 'Bengaluru'),
  ('BUS_STOP', 'Banaswadi Ring Road Stop', 13.0132, 77.6516, 'Bengaluru'),
  ('BUS_STOP', 'Mysore Road Satellite Stop', 12.9448, 77.5222, 'Bengaluru'),
  ('HOSPITAL', 'Shivshakti Hospital, 80 Feet Road', 25.183004, 75.872318, 'Kota');
