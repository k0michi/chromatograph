#include "CLibPNGBridge.h"
#include <png.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct slpng_read {
  png_structp png;
  uint8_t *data;
  size_t size, offset;
  char error[256];
};
struct slpng_write {
  png_structp png;
  uint8_t *data;
  size_t size, capacity;
  char error[256];
};
struct slpng_info {
  png_infop info;
  png_structp owner;
};

static void copy(char *dst, size_t n, const char *src) {
  if (dst && n)
    snprintf(dst, n, "%s", src ? src : "unknown libpng error");
}
static void fail(png_structp png, png_const_charp message) {
  char *storage = png_get_error_ptr(png);
  copy(storage, 256, message);
  png_longjmp(png, 1);
}
static void warn(png_structp png, png_const_charp message) {
  (void)png;
  (void)message;
}
static int read_failure(slpng_read *p, slpng_error *e) {
  copy(e ? e->message : NULL, e ? 256 : 0, p->error);
  return 0;
}
static int write_failure(slpng_write *p, slpng_error *e) {
  copy(e ? e->message : NULL, e ? 256 : 0, p->error);
  return 0;
}

static void read_fn(png_structp png, png_bytep out, size_t count) {
  slpng_read *p = png_get_io_ptr(png);
  if (!p || p->offset > p->size || count > p->size - p->offset)
    png_error(png, "unexpected end of input");
  memcpy(out, p->data + p->offset, count);
  p->offset += count;
}
static void write_fn(png_structp png, png_bytep bytes, size_t count) {
  slpng_write *p = png_get_io_ptr(png);
  if (!p || count > SIZE_MAX - p->size)
    png_error(png, "output size overflow");
  size_t required = p->size + count;
  if (required > p->capacity) {
    size_t capacity = p->capacity ? p->capacity : 4096;
    while (capacity < required && capacity <= SIZE_MAX / 2)
      capacity *= 2;
    if (capacity < required)
      capacity = required;
    uint8_t *data = realloc(p->data, capacity);
    if (!data)
      png_error(png, "output allocation failed");
    p->data = data;
    p->capacity = capacity;
  }
  memcpy(p->data + p->size, bytes, count);
  p->size = required;
}
static void flush_fn(png_structp png) { (void)png; }

slpng_read *slpng_create_read_struct(slpng_error *e) {
  slpng_read *p = calloc(1, sizeof(*p));
  if (!p)
    return NULL;
  p->png = png_create_read_struct(PNG_LIBPNG_VER_STRING, p->error, fail, warn);
  if (!p->png) {
    free(p);
    copy(e ? e->message : NULL, e ? 256 : 0, "png_create_read_struct failed");
    return NULL;
  }
  return p;
}
slpng_write *slpng_create_write_struct(slpng_error *e) {
  slpng_write *p = calloc(1, sizeof(*p));
  if (!p)
    return NULL;
  p->png = png_create_write_struct(PNG_LIBPNG_VER_STRING, p->error, fail, warn);
  if (!p->png) {
    free(p);
    copy(e ? e->message : NULL, e ? 256 : 0, "png_create_write_struct failed");
    return NULL;
  }
  return p;
}
void slpng_destroy_read_struct(slpng_read *p) {
  if (p) {
    if (p->png)
      png_destroy_read_struct(&p->png, NULL, NULL);
    free(p->data);
    free(p);
  }
}
void slpng_destroy_write_struct(slpng_write *p) {
  if (p) {
    if (p->png)
      png_destroy_write_struct(&p->png, NULL);
    free(p->data);
    free(p);
  }
}

static slpng_info *new_info(png_structp owner, slpng_error *e) {
  slpng_info *i = calloc(1, sizeof(*i));
  if (!i)
    return NULL;
  i->owner = owner;
  i->info = png_create_info_struct(owner);
  if (!i->info) {
    free(i);
    copy(e ? e->message : NULL, e ? 256 : 0, "png_create_info_struct failed");
    return NULL;
  }
  return i;
}
slpng_info *slpng_create_read_info_struct(slpng_read *p, slpng_error *e) {
  return p ? new_info(p->png, e) : NULL;
}
slpng_info *slpng_create_write_info_struct(slpng_write *p, slpng_error *e) {
  return p ? new_info(p->png, e) : NULL;
}
void slpng_destroy_info_struct(slpng_info *i) {
  if (i) {
    if (i->info)
      png_destroy_info_struct(i->owner, &i->info);
    free(i);
  }
}

int slpng_set_read_data(slpng_read *p, const uint8_t *data, size_t size,
                        slpng_error *e) {
  if (!p || !data || !size)
    return 0;
  uint8_t *copy_data = malloc(size);
  if (!copy_data)
    return 0;
  memcpy(copy_data, data, size);
  free(p->data);
  p->data = copy_data;
  p->size = size;
  p->offset = 0;
  if (setjmp(png_jmpbuf(p->png)))
    return read_failure(p, e);
  png_set_read_fn(p->png, p, read_fn);
  return 1;
}
int slpng_set_write_data(slpng_write *p, slpng_error *e) {
  if (!p)
    return 0;
  if (setjmp(png_jmpbuf(p->png)))
    return write_failure(p, e);
  png_set_write_fn(p->png, p, write_fn, flush_fn);
  return 1;
}
#define R(P, E, X)                                                             \
  do {                                                                         \
    (P)->error[0] = 0;                                                         \
    if (setjmp(png_jmpbuf((P)->png)))                                          \
      return read_failure(P, E);                                               \
    X;                                                                         \
    return 1;                                                                  \
  } while (0)
#define W(P, E, X)                                                             \
  do {                                                                         \
    (P)->error[0] = 0;                                                         \
    if (setjmp(png_jmpbuf((P)->png)))                                          \
      return write_failure(P, E);                                              \
    X;                                                                         \
    return 1;                                                                  \
  } while (0)
int slpng_read_info(slpng_read *p, slpng_info *i, slpng_error *e) {
  R(p, e, png_read_info(p->png, i->info));
}
int slpng_get_IHDR_read(slpng_read *p, slpng_info *i, slpng_ihdr *h,
                        slpng_error *e) {
  if (!p || !i || !h)
    return 0;
  R(p, e,
    if (!png_get_IHDR(p->png, i->info, &h->width, &h->height, &h->bit_depth,
                      &h->color_type, &h->interlace_method,
                      &h->compression_method, &h->filter_method))
        png_error(p->png, "IHDR unavailable"));
}
int slpng_set_expand(slpng_read *p, slpng_error *e) {
  R(p, e, png_set_expand(p->png));
}
int slpng_set_strip_16(slpng_read *p, slpng_error *e) {
  R(p, e, png_set_strip_16(p->png));
}
int slpng_set_gray_to_rgb(slpng_read *p, slpng_error *e) {
  R(p, e, png_set_gray_to_rgb(p->png));
}
int slpng_set_add_alpha(slpng_read *p, uint32_t f, int after, slpng_error *e) {
  R(p, e,
    png_set_add_alpha(p->png, f, after ? PNG_FILLER_AFTER : PNG_FILLER_BEFORE));
}
int slpng_read_update_info(slpng_read *p, slpng_info *i, slpng_error *e) {
  R(p, e, png_read_update_info(p->png, i->info));
}
size_t slpng_get_rowbytes(slpng_read *p, slpng_info *i) {
  return p && i ? png_get_rowbytes(p->png, i->info) : 0;
}
int slpng_get_channels(slpng_read *p, slpng_info *i) {
  return p && i ? png_get_channels(p->png, i->info) : 0;
}
png_uint_32 slpng_get_valid(slpng_read *p, slpng_info *i, png_uint_32 flag) {
  return p && i ? png_get_valid(p->png, i->info, flag) : 0;
}
int slpng_read_row(slpng_read *p, uint8_t *row, size_t n, uint8_t *display,
                   size_t dn, slpng_error *e) {
  if (!p || !row || !n)
    return 0;
  (void)dn;
  R(p, e, png_read_row(p->png, row, display));
}
int slpng_read_image(slpng_read *p, slpng_info *i, uint8_t *pixels, size_t size,
                     size_t rowbytes, slpng_error *e) {
  if (!p || !i || !pixels)
    return 0;
  png_uint_32 height = png_get_image_height(p->png, i->info);
  size_t required_rowbytes = png_get_rowbytes(p->png, i->info);
  if (rowbytes < required_rowbytes ||
      (height != 0 && rowbytes > SIZE_MAX / height) ||
      size < rowbytes * height || (size_t)height > SIZE_MAX / sizeof(png_bytep))
    return 0;
  png_bytep *rows = malloc(sizeof(*rows) * height);
  if (!rows)
    return 0;
  for (png_uint_32 y = 0; y < height; ++y)
    rows[y] = pixels + rowbytes * y;
  p->error[0] = 0;
  if (setjmp(png_jmpbuf(p->png))) {
    free(rows);
    return read_failure(p, e);
  }
  png_read_image(p->png, rows);
  free(rows);
  return 1;
}
int slpng_read_end(slpng_read *p, slpng_info *i, slpng_error *e) {
  R(p, e, png_read_end(p->png, i ? i->info : NULL));
}
int slpng_set_IHDR_write(slpng_write *p, slpng_info *i, const slpng_ihdr *h,
                         slpng_error *e) {
  if (!p || !i || !h)
    return 0;
  W(p, e,
    png_set_IHDR(p->png, i->info, h->width, h->height, h->bit_depth,
                 h->color_type, h->interlace_method, h->compression_method,
                 h->filter_method));
}
int slpng_write_info(slpng_write *p, slpng_info *i, slpng_error *e) {
  W(p, e, png_write_info(p->png, i->info));
}
size_t slpng_get_rowbytes_write(slpng_write *p, slpng_info *i) {
  return p && i ? png_get_rowbytes(p->png, i->info) : 0;
}
int slpng_write_row(slpng_write *p, const uint8_t *row, size_t n,
                    slpng_error *e) {
  if (!p || !row || !n)
    return 0;
  W(p, e, png_write_row(p->png, (png_const_bytep)row));
}
int slpng_write_end(slpng_write *p, slpng_info *i, slpng_error *e) {
  W(p, e, png_write_end(p->png, i ? i->info : NULL));
}
const uint8_t *slpng_write_data(const slpng_write *p) {
  return p ? p->data : NULL;
}
size_t slpng_write_size(const slpng_write *p) { return p ? p->size : 0; }
