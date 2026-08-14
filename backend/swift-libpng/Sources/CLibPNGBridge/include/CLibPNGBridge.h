#ifndef SWIFT_LIBPNG_BRIDGE_H
#define SWIFT_LIBPNG_BRIDGE_H
#include <png.h>
#include <stddef.h>
#include <stdint.h>

enum { SLPNG_INFO_tRNS = PNG_INFO_tRNS };

typedef struct slpng_read slpng_read;
typedef struct slpng_write slpng_write;
typedef struct slpng_info slpng_info;
typedef struct {
  char message[256];
} slpng_error;
typedef struct {
  uint32_t width, height;
  int bit_depth, color_type, interlace_method, compression_method,
      filter_method;
} slpng_ihdr;

slpng_read *slpng_create_read_struct(slpng_error *);
slpng_write *slpng_create_write_struct(slpng_error *);
void slpng_destroy_read_struct(slpng_read *);
void slpng_destroy_write_struct(slpng_write *);
slpng_info *slpng_create_read_info_struct(slpng_read *, slpng_error *);
slpng_info *slpng_create_write_info_struct(slpng_write *, slpng_error *);
void slpng_destroy_info_struct(slpng_info *);

int slpng_set_read_data(slpng_read *, const uint8_t *, size_t, slpng_error *);
int slpng_set_write_data(slpng_write *, slpng_error *);
int slpng_read_info(slpng_read *, slpng_info *, slpng_error *);
int slpng_get_IHDR_read(slpng_read *, slpng_info *, slpng_ihdr *,
                        slpng_error *);
int slpng_set_expand(slpng_read *, slpng_error *);
int slpng_set_strip_16(slpng_read *, slpng_error *);
int slpng_set_gray_to_rgb(slpng_read *, slpng_error *);
int slpng_set_add_alpha(slpng_read *, uint32_t, int, slpng_error *);
int slpng_read_update_info(slpng_read *, slpng_info *, slpng_error *);
size_t slpng_get_rowbytes(slpng_read *, slpng_info *);
int slpng_get_channels(slpng_read *, slpng_info *);
png_uint_32 slpng_get_valid(slpng_read *, slpng_info *, png_uint_32);
int slpng_read_row(slpng_read *, uint8_t *, size_t, uint8_t *, size_t,
                   slpng_error *);
int slpng_read_image(slpng_read *, slpng_info *, uint8_t *, size_t, size_t,
                     slpng_error *);
int slpng_read_end(slpng_read *, slpng_info *, slpng_error *);

int slpng_set_IHDR_write(slpng_write *, slpng_info *, const slpng_ihdr *,
                         slpng_error *);
int slpng_write_info(slpng_write *, slpng_info *, slpng_error *);
size_t slpng_get_rowbytes_write(slpng_write *, slpng_info *);
int slpng_write_row(slpng_write *, const uint8_t *, size_t, slpng_error *);
int slpng_write_end(slpng_write *, slpng_info *, slpng_error *);
const uint8_t *slpng_write_data(const slpng_write *);
size_t slpng_write_size(const slpng_write *);
#endif
