struct Ray {
    orig: vec3f,
    dir: vec3f,
    tm: f32,
};

struct Camera {
    resolution: vec2f,
    tanHalfFovY: f32,
    focalLength: f32,

    position: vec3f,
    _pad0: f32,

    // unit basis vectors from cam coord frame
    u: vec3f,
    _pad1: f32,

    v: vec3f,
    _pad2: f32,

    w: vec3f,
    _pad3: f32,
};

struct Material {
    kind: u32,
    fuzz: f32,
    refractionIndex: f32,
    _pad0: u32,

    albedo: vec3f, // per color channel reflectance
    _pad1: f32,
}

struct Sphere {
    center0: vec3f,
    radius: f32,

    center1: vec3f,
    materialIndex: u32,
}

struct HitRecord {
    p: vec3f,
    normal: vec3f,
    t: f32,
    hit: bool,
    frontFace: bool,
    materialIndex: u32
}

struct ScatterRecord {
    scatter: bool,
    attenuation: vec3f,
    scatterRay: Ray
}

struct Interval {
    min: f32,
    max: f32
}

struct Params {
    frameIndex: u32,
    samplesPerFrame: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0)
var<uniform> camera: Camera;

@group(0) @binding(1)
var<storage, read> spheres: array<Sphere>;

@group(0) @binding(2)
var<storage, read> materials: array<Material>;

@group(0) @binding(3)
var<uniform> params: Params;

@group(0) @binding(4)
var oldAccum: texture_2d<f32>;

const INFINITY: f32 = 1e30;
const PI: f32 = 3.1415926535897932385;

// material tag
const MAT_LAMBERTIAN: u32 = 0u;
const MAT_METAL: u32 = 1u;
const MAT_DIELECTRIC: u32 = 2u;

const maxDepth: u32 = 50u;

const defocusAngle = 0.6; // variation angle of rays through each pixel
const focusDist = 10.0; // dist from cam lookfrom point to plane of perfect focus

const vfov: f32 = 90; // vertical view angle

// util
fn surrounds(interval: Interval, val: f32) -> bool {
    return (interval.min < val) && (val < interval.max);
}

fn rngNext(seed: ptr<function, u32>) -> u32 {
    // xorshift32 RNG
    var x = *seed;

    x = x ^ (x << 13u);
    x = x ^ (x >> 17u);
    x = x ^ (x << 5u);
    
    *seed = x;
    return x;
}

fn randomFloat(seed: ptr<function, u32>) -> f32 {
    return f32(rngNext(seed)) / 4294967296.0; // 2 ** 32 = 4294967296
}

fn randomRange(seed: ptr<function, u32>, minVal: f32, maxVal: f32) -> f32 {
    return minVal + (maxVal - minVal) * randomFloat(seed);
}

fn degreesToRadians(degree: f32) -> f32 {
    return degree * PI / 180;
}

fn sampleSquare(seed: ptr<function, u32>) -> vec2f {
    // return vector to random point in [-0.5, +0.5] unit square
    return vec2f(
        randomFloat(seed) - 0.5,
        randomFloat(seed) - 0.5
    );
}

fn randomUnitVector(seed: ptr<function, u32>) -> vec3f {
    loop {
        let x = randomRange(seed, -1.0, 1.0);
        let y = randomRange(seed, -1.0, 1.0);
        let z = randomRange(seed, -1.0, 1.0);

        let p = vec3f(x, y, z);
        let lensq = dot(p, p);

        if (1e-12 < lensq && lensq <= 1.0) { // prevent div sqrt(0.0)
            return p / sqrt(lensq);
        }
    }
}

fn randomInUnitDisk(seed: ptr<function, u32>) -> vec3f {
    loop {
        let p = vec3f(randomRange(seed, -1.0, 1.0), randomRange(seed, -1.0, 1.0), 0.0);
        if (dot(p, p) < 1.0) {
            return p;
        }
    }
}

fn defocusDiskSample(seed: ptr<function, u32>) -> vec3f {
    // returns a random point in camera defocus disk
    let defocusRadius = focusDist * tan(degreesToRadians(defocusAngle / 2));
    let defocusDiskU = camera.u * defocusRadius;
    let defocusDiskV = camera.v * defocusRadius;

    let p = randomInUnitDisk(seed);
    return camera.position + (p.x * defocusDiskU) + (p.y * defocusDiskV);
}

// fn randomOnHemisphere(seed: ptr<function, u32>, normal: vec3f) -> vec3f {
//     let onUnitSphere = randomUnitVector(seed);
//     if (dot(onUnitSphere, normal) > 0.0) { // same hemisphere as normal
//         return onUnitSphere;
//     } else {
//         return -onUnitSphere;
//     }
// }

fn linearToGamma(component: f32) -> f32 {
    // simple gamma 2
    if (component > 0.0) {
        return sqrt(component);
    }
    return 0;
}

fn colorCorrection(color: vec3f) -> vec3f {
    let r = linearToGamma(color.x);
    let g = linearToGamma(color.y);
    let b = linearToGamma(color.z);

    return vec3f(r, g, b);
}

fn sphereCenter(s: Sphere, time: f32) -> vec3f {
    return s.center0 + time * (s.center1 - s.center0);
}

fn reflect(v: vec3f, normal: vec3f) -> vec3f {
    return v - 2 * dot(v, normal) * normal;
}

fn refract(uv: vec3f, normal: vec3f, etaiOverEtat: f32) -> vec3f {
    // solve for incoming unit vector splitted into perpendicular and parallel ray
    let cosTheta = min(dot(-uv, normal), 1.0);
    let rOutPerp = etaiOverEtat * (uv + (cosTheta * normal));
    let rOutParallel = -sqrt(abs(1.0 - dot(rOutPerp, rOutPerp))) * normal;
    return rOutPerp + rOutParallel;
}

fn reflectance(cosine: f32, refractionIndex: f32) -> f32 {
    // reflection probability based on viewing angle
    // use Schlick's approx
    var r0 = (1 - refractionIndex) / (1 + refractionIndex);
    r0 = r0 * r0;
    return r0 + (1 - r0) * pow((1 - cosine), 5);
}

// functions
fn scatter(rIn: Ray, rec: HitRecord, mat: Material, seed: ptr<function, u32>) -> ScatterRecord {
    var result: ScatterRecord;

    if (mat.kind == MAT_LAMBERTIAN) {
        // true lambertial reflection
        var direction = rec.normal + randomUnitVector(seed); // true lambertian reflection
        
        // catch degenerate scatter direction
        if (dot(direction, direction) < 1e-8) {
            direction = rec.normal;
        }

        result.scatter = true;
        result.attenuation = mat.albedo;
        result.scatterRay = Ray(rec.p, direction, rIn.tm);

        return result;
    } 

    if (mat.kind == MAT_METAL) {
        var reflected = reflect(rIn.dir, rec.normal);
        reflected = normalize(reflected) + (min(mat.fuzz, 1.0) * randomUnitVector(seed));

        result.scatter = dot(reflected, rec.normal) > 0.0;
        result.attenuation = mat.albedo;
        result.scatterRay = Ray(rec.p, reflected, rIn.tm);

        return result;
    }

    if (mat.kind == MAT_DIELECTRIC) {
        // set refraction index based on ray inside or outside obj
        let ri = select(mat.refractionIndex, 1.0 / mat.refractionIndex, rec.frontFace);

        let unitDirection = normalize(rIn.dir);
        let cosTheta = min(dot(-unitDirection, rec.normal), 1.0);
        let sinTheta = sqrt(1.0 - (cosTheta * cosTheta));

        // total internal reflection
        let cannotRefract = ri * sinTheta > 1.0;
        var direction: vec3f;

        if (cannotRefract || reflectance(cosTheta, ri) > randomFloat(seed)) {
            direction = reflect(unitDirection, rec.normal);
        } else {
            direction = refract(unitDirection, rec.normal, ri);
        }

        result.scatter = true;
        result.attenuation = vec3f(1.0, 1.0, 1.0);
        result.scatterRay = Ray(rec.p, direction, rIn.tm);

        return result;
    }

    // default absorbed
    result.scatter = false;
    result.attenuation = vec3f(0.0);
    result.scatterRay = rIn;

    return result;
}

fn rayAt(r: Ray, t: f32) -> vec3f {
    return r.orig + t * r.dir;
}

fn getRay(fragCoord: vec2f, seed: ptr<function, u32>) -> Ray {
    // normalized 2D img coord
    let offset = sampleSquare(seed);
    let uv = (fragCoord + offset) / camera.resolution;

    let aspect = camera.resolution.x / camera.resolution.y;
    let halfHeight = camera.tanHalfFovY * camera.focalLength;

    // remapped 2D img-plane offset in world space
    let x = ((2.0 * uv.x) - 1.0) * (aspect * halfHeight);
    let y = (1.0 - (2.0 * uv.y)) * halfHeight;

    // 3D world space point build from offsets
    let pixelSample = camera.position + (x * camera.u) + (y * camera.v) - (focusDist * camera.w);

    let rayOrigin = select(defocusDiskSample(seed), camera.position, defocusAngle <= 0);
    let rayDirection = pixelSample - rayOrigin;
    let rayTime = randomFloat(seed);
    
    return Ray(rayOrigin, rayDirection, rayTime);
}

fn setFaceNormal(rec: HitRecord, r: Ray, outwardNormal: vec3f) -> HitRecord {
    // set normal to face outward (dot < 0)
    // outwardNormal is assumed to have unit len

    var out = rec;

    out.frontFace = dot(r.dir, outwardNormal) < 0.0;
    if (out.frontFace) {
        out.normal = outwardNormal;
    } else {
        out.normal = -outwardNormal;
    }

    return out;
}

fn hitSphere(s: Sphere, r: Ray, interval: Interval) -> HitRecord {
    var rec: HitRecord;
    rec.hit = false;

    let center = sphereCenter(s, r.tm);
    let oc = center - r.orig; // ray origin to sphere center
    let a = dot(r.dir, r.dir);
    let h = dot(r.dir, oc); // b = -2h
    let c = dot(oc, oc) - (s.radius * s.radius);
    let discriminant = h * h - a * c;

    if (discriminant < 0.0) {
        return rec;
    }

    let sqrtd = sqrt(discriminant);
    var root = (h - sqrtd) / a;

    // find nearest root (ray time) lies in acceptable range
    if (!surrounds(interval, root)) {
        root = (h + sqrtd) / a; // try another root
        if (!surrounds(interval, root)) {
            return rec;
        }
    }

    rec.t = root;
    rec.p = rayAt(r, rec.t);
    let outwardNormal = (rec.p - center) / s.radius; // unit normal
    rec = setFaceNormal(rec, r, outwardNormal);
    rec.materialIndex = s.materialIndex;

    rec.hit = true;

    return rec;
}

fn hitWorld(r: Ray, interval: Interval) -> HitRecord {
    var rec: HitRecord;
    rec.hit = false;

    var closestSoFar = interval.max;
    let sphereCount = arrayLength(&spheres); // world is just spheres now

    for (var i = 0u; i < sphereCount; i = i + 1u) {
        let currentInterval = Interval(interval.min, closestSoFar);
        let tempRec = hitSphere(spheres[i], r, currentInterval);

        if (tempRec.hit) {
            closestSoFar = tempRec.t;
            rec = tempRec;
        }
    }

    return rec;
}

fn rayColor(r0: Ray, seed: ptr<function, u32>) -> vec3f {
    var r = r0;
    var attenuation = vec3f(1.0, 1.0, 1.0);

    // bouncing ray
    for (var depth = 0u; depth < maxDepth; depth = depth + 1u) {
        let rec = hitWorld(r, Interval(0.001, INFINITY)); // fix shadow acne
        if (rec.hit) {
            let mat = materials[rec.materialIndex];
            let s: ScatterRecord = scatter(r, rec, mat, seed);

            if (!s.scatter) {
                return vec3f(0.0);
            }

            attenuation = attenuation * s.attenuation;
            r = s.scatterRay;
        } else {
            let unitDirection = normalize(r.dir);
            let a = 0.5 * (unitDirection.y + 1.0); // norm from -1..1 to 0..1
            let color = (1.0 - a) * vec3f(1.0, 1.0, 1.0) + a * vec3f(0.5, 0.7, 1.0); // env gradient

            return attenuation * color;
        }
    }

    return vec3(0.0, 0.0, 0.0);
}

@fragment fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    var pixelColor = vec3f(0.0);

    for (var sample = 0u; sample < params.samplesPerFrame; sample = sample + 1u) {
        // create random seed
        var seed = (u32(fragCoord.x) * 1973u) 
        + (u32(fragCoord.y) * 9277u) 
        + params.frameIndex * 26699u
        + sample * 104729u
        + 911u;

        let r = getRay(fragCoord.xy, &seed);
        pixelColor += rayColor(r, &seed);
    }

    pixelColor /= f32(params.samplesPerFrame);

    // calc color w/ running avg
    let pixel = vec2u(fragCoord.xy);
    let oldColor = textureLoad(oldAccum, pixel, 0).rgb;

    let frame = f32(params.frameIndex);
    let accumulatedColor = (oldColor * frame + pixelColor) / (frame + 1.0);

    return vec4f(accumulatedColor, 1.0);
}