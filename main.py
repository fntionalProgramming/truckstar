import os
import csv
import random
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GRAPHHOPPER_API_KEY = os.getenv("GRAPHHOPPER_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY")

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

LOAD_STATUSES = {
    "open",
    "booked",
    "in_transit",
    "pending_verification",
    "delivered",
}

# Only routes fully within these provinces are eligible for the
# simulated "Test" button. Anything crossing into/out of a US state
# or another Canadian province is filtered out.
ALLOWED_PROVINCES = {"QC", "ON"}

def geocode_address(address):
    """
    Convert an address into latitude/longitude using Nominatim.
    """
    response = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={
            "format": "json",
            "q": address,
            "limit": 1,
        },
        headers={
            "User-Agent": "EmptyMile-Hackathon/1.0"
        },
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    if not data:
        raise ValueError(
            f"Could not find location coordinates for: {address}"
        )
    return {
        "lat": float(data[0]["lat"]),
        "lng": float(data[0]["lon"]),
    }

def photon_search(query):
    """
    Search for addresses using Photon.
    """
    response = requests.get(
        "https://photon.komoot.io/api/",
        params={"q": query, "limit": 5,},
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    suggestions = []
    for feature in data.get("features", []):
        properties = feature.get("properties", {})
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) != 2:
            continue
        name = properties.get("name", "")
        street = properties.get("street", "")
        city = (
            properties.get("city")
            or properties.get("county")
            or properties.get("state")
            or ""
        )
        country = properties.get("country", "")
        parts = []
        if name:
            parts.append(name)
        if street:
            parts.append(street)
        if city:
            parts.append(city)
        if country:
            parts.append(country)
        full_address = ", ".join(parts)
        suggestions.append({"text": full_address, "lat": coordinates[1], "lng": coordinates[0],})
    return suggestions

def calculate_route(start_lat, start_lng, end_lat, end_lng,):
    """
    Calculate a driving route using GraphHopper.
    """
    if not GRAPHHOPPER_API_KEY:
        raise RuntimeError("Missing GRAPHHOPPER_API_KEY")
    response = requests.get(
        "https://graphhopper.com/api/1/route",
        params={
            "point": [
                f"{start_lat},{start_lng}",
                f"{end_lat},{end_lng}",
            ],
            "profile": "car",
            "key": GRAPHHOPPER_API_KEY,
            "points_encoded": "false",
        },
        timeout=15,
    )

    response.raise_for_status()

    data = response.json()

    if not data.get("paths"):
        raise ValueError("No route found")
    path = data["paths"][0]
    coordinates = [[point[1], point[0]]for point in path["points"]["coordinates"]]
    return {"coordinates": coordinates,"distance": path.get("distance"), "time": path.get("time"),}

def get_load(load_id):
    response = (supabase.table("loads").select("*").eq("id", load_id).maybe_single().execute())
    if not response.data:
        return None
    return response.data


def update_load_status(load_id, new_status):
    if new_status not in LOAD_STATUSES:
        raise ValueError(
            f"Invalid status: {new_status}"
        )
    response = (supabase.table("loads").update({"status": new_status}).eq("id", load_id).execute())
    if not response.data:
        raise ValueError("Load not found")
    return response.data[0]

CSV_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "data.csv",
)

FALLBACK_DRIVER_NAMES = [
    "J. Reyes", "M. Okafor", "T. Dubois", "A. Singh", "L. Park",
    "R. Novak", "S. Ibrahim", "C. Alvarez", "K. Larsen", "P. Morrow",
]

def _clean_csv_value(row, key):
    """
    CSV export uses the literal string "<null>" for empty cells.
    Normalize that (and blank/whitespace-only strings) to None.
    """
    value = (row.get(key) or "").strip()
    if value == "" or value == "<null>":
        return None
    return value

def load_simulation_rows():
    """
    Read data.csv into a list of cleaned, ready-to-dispatch
    sample loads. Runs once at startup.

    Only rows where BOTH the origin and destination province are
    in ALLOWED_PROVINCES (QC / ON) are kept - anything that crosses
    into a US state or another Canadian province is dropped.
    """
    rows = []
    if not os.path.exists(CSV_PATH):
        print(f"[simulation] data.csv not found at {CSV_PATH} - Test button will be unavailable.")
        return rows

    skipped_out_of_region = 0

    with open(CSV_PATH, newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        for raw_row in reader:
            origin_city = _clean_csv_value(raw_row, "ORIGCITY")
            origin_prov = _clean_csv_value(raw_row, "ORIGPROV")
            dest_city = _clean_csv_value(raw_row, "DESTCITY")
            dest_prov = _clean_csv_value(raw_row, "DESTPROV")
            company_name = _clean_csv_value(raw_row, "CALLNAME")
            cargo_description = _clean_csv_value(raw_row, "LOAD_DESCRIPTION")
            distance_raw = _clean_csv_value(raw_row, "DISTANCE")
            if not all([
                origin_city, origin_prov,
                dest_city, dest_prov,
                company_name, cargo_description,
                distance_raw,
            ]):
                continue

            origin_prov_norm = origin_prov.strip().upper()
            dest_prov_norm = dest_prov.strip().upper()
            if (
                origin_prov_norm not in ALLOWED_PROVINCES
                or dest_prov_norm not in ALLOWED_PROVINCES
            ):
                skipped_out_of_region += 1
                continue

            try:
                distance = float(distance_raw)
            except ValueError:
                continue
            if distance <= 0:
                continue
            driver_name = (
                _clean_csv_value(raw_row, "PICK_UP_DRIVER")
                or _clean_csv_value(raw_row, "DELIVERY_DRIVER")
            )
            rows.append({
                "company_name": company_name,
                "origin_city": f"{origin_city}, {origin_prov_norm}",
                "destination_city": f"{dest_city}, {dest_prov_norm}",
                "cargo_description": cargo_description,
                "distance": distance,
                "driver_name": driver_name,
            })

    print(
        f"[simulation] Skipped {skipped_out_of_region} rows outside "
        f"{sorted(ALLOWED_PROVINCES)} (origin/destination province)."
    )
    return rows
SIMULATION_ROWS = load_simulation_rows()
print(f"[simulation] Loaded {len(SIMULATION_ROWS)} usable rows from data.csv")
@app.get("/api/health")
def health_check():
    return jsonify({
        "status": "ok"
    })
@app.get("/api/loads")
def get_loads():
    try:
        response = (supabase.table("loads").select("*").execute())
        return jsonify({
            "loads": response.data or []
        })
    except Exception as error:
        print("GET /api/loads error:", error)
        return jsonify({
            "error": str(error)
        }), 500
@app.get("/api/loads/<load_id>")
def get_single_load(load_id):
    try:
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        return jsonify(load)
    except Exception as error:
        return jsonify({
            "error": str(error)
        }), 500
@app.post("/api/loads")
def create_load():
    try:
        body = request.get_json()
        if not body:
            return jsonify({
                "error": "Request body is required"
            }), 400
        company_name = body.get("company_name")
        payout = body.get("payout")
        cargo_description = body.get("cargo_description")
        origin_city = body.get("origin_city")
        destination_city = body.get("destination_city")
        if not company_name:
            return jsonify({
                "error": "company_name is required"
            }), 400
        if not origin_city:
            return jsonify({
                "error": "origin_city is required"
            }), 400
        if not destination_city:
            return jsonify({
                "error": "destination_city is required"
            }), 400
        origin_lat = body.get("lat_coords")
        origin_lng = body.get("lng_coords")
        destination_lat = body.get("dest_lat")
        destination_lng = body.get("dest_lng")
        if origin_lat is None or origin_lng is None:
            origin = geocode_address(origin_city)
            origin_lat = origin["lat"]
            origin_lng = origin["lng"]
        if destination_lat is None or destination_lng is None:
            destination = geocode_address(destination_city)
            destination_lat = destination["lat"]
            destination_lng = destination["lng"]
        load = {
            "company_name": company_name,
            "payout": payout,
            "cargo_description": cargo_description,
            "origin_city": origin_city,
            "destination_city": destination_city,
            "lat_coords": origin_lat,
            "lng_coords": origin_lng,
            "dest_lat": destination_lat,
            "dest_lng": destination_lng,
            "status": "open",
        }
        response = (supabase.table("loads").insert(load).execute())
        if not response.data:
            raise RuntimeError("Failed to create load")
        return jsonify({
            "load": response.data[0]
        }), 201
    except Exception as error:
        print("POST /api/loads error:", error)
        return jsonify({
            "error": str(error)
        }), 500
@app.get("/api/simulation/random-load")
def simulation_random_load():
    if not SIMULATION_ROWS:
        return jsonify({
            "error": "No simulation data is loaded on the server (data.csv missing or empty)."
        }), 404
    row = random.choice(SIMULATION_ROWS)
    rate_per_mile = random.uniform(2.75, 4.5)
    payout = max(250, round(row["distance"] * rate_per_mile, -1))
    driver_name = row["driver_name"] or random.choice(FALLBACK_DRIVER_NAMES)
    return jsonify({
        "company_name": row["company_name"],
        "origin_city": row["origin_city"],
        "destination_city": row["destination_city"],
        "cargo_description": row["cargo_description"],
        "distance": row["distance"],
        "payout": payout,
        "driver_name": driver_name,
    })
@app.post("/api/loads/<load_id>/accept")
def accept_load(load_id):
    try:
        body = request.get_json() or {}
        driver_name = body.get("driver_name")
        driver_phone = body.get("driver_phone")
        driver_email = body.get("driver_email")
        est_pickup = body.get("est_pickup")
        est_dropoff = body.get("est_dropoff")
        driver_lat = body.get("driver_lat")
        driver_lng = body.get("driver_lng")
        if not driver_name:
            return jsonify({
                "error": "driver_name is required"
            }), 400
        if driver_lat is None or driver_lng is None:
            return jsonify({
                "error": "Driver location is required"
            }), 400
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        if load["status"] != "open":
            return jsonify({
                "error": "Load is no longer available"
            }), 409
        update = {
            "status": "booked",
            "driver_name": driver_name,
            "driver_phone": driver_phone,
            "driver_email": driver_email,
            "est_pickup": est_pickup,
            "est_dropoff": est_dropoff,
            "driver_lat": driver_lat,
            "driver_lng": driver_lng,
        }
        response = (supabase.table("loads").update(update).eq("id", load_id).execute())
        if not response.data:
            raise RuntimeError("Failed to accept load")
        return jsonify({
            "load": response.data[0]
        })
    except Exception as error:
        print("POST /accept error:", error)
        return jsonify({
            "error": str(error)
        }), 500

@app.post("/api/loads/<load_id>/location")
def update_driver_location(load_id):
    try:
        body = request.get_json() or {}
        lat = body.get("lat")
        lng = body.get("lng")
        if lat is None or lng is None:
            return jsonify({
                "error": "lat and lng are required"
            }), 400
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        if load["status"] not in {"booked", "in_transit", "pending_verification",}:
            return jsonify({
                "error": "Load is not actively tracked"
            }), 400
        response = (supabase.table("loads").update({"driver_lat": float(lat), "driver_lng": float(lng),}).eq("id", load_id).execute())
        return jsonify({
            "load": response.data[0]
        })
    except Exception as error:
        print("POST /location error:", error)
        return jsonify({
            "error": str(error)
        }), 500
@app.post("/api/loads/<load_id>/pickup")
def pickup_load(load_id):
    try:
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        if load["status"] != "booked":
            return jsonify({
                "error": "Load must be booked before pickup"
            }), 409
        updated = update_load_status(load_id, "in_transit")
        return jsonify({
            "load": updated
        })
    except Exception as error:
        return jsonify({
            "error": str(error)
        }), 500

@app.post("/api/loads/<load_id>/complete")
def complete_delivery(load_id):
    try:
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        if load["status"] != "in_transit":
            return jsonify({
                "error": "Load must be in transit"
            }), 409
        updated = update_load_status(load_id, "pending_verification")
        return jsonify({
            "load": updated
        })
    except Exception as error:
        return jsonify({
            "error": str(error)
        }), 500

@app.post("/api/loads/<load_id>/verify")
def verify_delivery(load_id):
    try:
        load = get_load(load_id)
        if not load:
            return jsonify({
                "error": "Load not found"
            }), 404
        if load["status"] != "pending_verification":
            return jsonify({
                "error": "Load is not awaiting verification"
            }), 409
        updated = update_load_status(load_id, "delivered")
        return jsonify({"load": updated})

    except Exception as error:
        return jsonify({
            "error": str(error)
        }), 500

@app.get("/api/geocode")
def geocode():
    try:
        address = request.args.get("address")

        if not address:
            return jsonify({
                "error": "address is required"
            }), 400
        result = geocode_address(address)
        return jsonify(result)

    except Exception as error:
        return jsonify({
            "error": str(error)
        }), 500
@app.get("/api/autocomplete")
def autocomplete():
    try:
        query = request.args.get("q", "").strip()
        if len(query) < 3:
            return jsonify({"suggestions": []})
        suggestions = photon_search(query)
        return jsonify({"suggestions": suggestions})
    except Exception as error:
        print("Autocomplete error:", error)
        return jsonify({
            "error": str(error)
        }), 500

@app.get("/api/route")
def route():
    try:
        start_lat = request.args.get("start_lat", type=float)
        start_lng = request.args.get("start_lng", type=float)
        end_lat = request.args.get("end_lat", type=float)
        end_lng = request.args.get("end_lng", type=float)
        if None in (start_lat, start_lng, end_lat, end_lng):
            return jsonify({
                "error": "All coordinates are required"
            }), 400
        result = calculate_route(start_lat, start_lng, end_lat,end_lng,)
        return jsonify(result)
    except Exception as error:
        print("Route error:", error)
        return jsonify({"error": str(error)}), 500


# server setup 
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True,)