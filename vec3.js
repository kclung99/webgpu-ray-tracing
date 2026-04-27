// impl minimal Vec3 class ref gl-matrix syntax
class Vec3 extends Float32Array {
    constructor(x = 0, y = 0, z = 0) {
        super(3);

        this[0] = x;
        this[1] = y;
        this[2] = z;
    }

    static fromValues(x, y, z) {
        return new Vec3(x, y, z);
    }

    static create() {
        return new Vec3(0.0, 0.0, 0.0);
    }

    static random(min = 0, max = 1) {
        return new Vec3(
            min + (max - min) * Math.random(),
            min + (max - min) * Math.random(),
            min + (max - min) * Math.random(),
        );
    }

    static copy(out, a) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        return out;
    }

    static set(out, x, y, z) {
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    }

    static add(out, a, b) {
        out[0] = a[0] + b[0];
        out[1] = a[1] + b[1];
        out[2] = a[2] + b[2];
        return out;
    }

    static sub(out, a, b) {
        out[0] = a[0] - b[0];
        out[1] = a[1] - b[1];
        out[2] = a[2] - b[2];
        return out;
    }

    static mul(out, a, b) {
        out[0] = a[0] * b[0];
        out[1] = a[1] * b[1];
        out[2] = a[2] * b[2];
        return out;
    }

    static scale(out, a, t) {
        out[0] = a[0] * t;
        out[1] = a[1] * t;
        out[2] = a[2] * t;
        return out;
    }

    static div(out, a, t) {
        return Vec3.scale(out, a, 1 / t);
    }

    static negate(out, a) {
        out[0] = -a[0];
        out[1] = -a[1];
        out[2] = -a[2];
        return out;
    }

    static dot(a, b) {
        return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    }

    static cross(out, a, b) {
        const ax = a[0];
        const ay = a[1];
        const az = a[2];

        const bx = b[0];
        const by = b[1];
        const bz = b[2];

        out[0] = ay * bz - az * by;
        out[1] = az * bx - ax * bz;
        out[2] = ax * by - ay * bx;

        return out;
    }

    static squaredLength(a) {
        return (a[0] * a[0]) + (a[1] * a[1]) + (a[2] * a[2]);
    }

    static length(a) {
        return Math.sqrt(Vec3.squaredLength(a));
    }

    static normalize(out, a) {
        const len = Vec3.length(a);

        if (len === 0) {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            return out;
        }

        return Vec3.scale(out, a, 1 / len);
    }
}

export const vec3 = Vec3;