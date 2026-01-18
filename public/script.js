/*
 * Frontend logic for the photo gallery. Fetches the list of images from the
 * server, renders them in a responsive grid and handles the upload modal.
 */

document.addEventListener('DOMContentLoaded', () => {
  const galleryEl = document.getElementById('gallery');
  const uploadButton = document.getElementById('uploadButton');
  const deleteToggle = document.getElementById('deleteToggle');
  const modalEl = document.getElementById('modal');
  const closeModal = document.getElementById('closeModal');
  const cancelUpload = document.getElementById('cancelUpload');
  const uploadForm = document.getElementById('uploadForm');
  const toastEl = document.getElementById('toast');
  const prefix = window.location.pathname.startsWith('/photos') ? '/photos' : '';
  const imageModal = document.getElementById('imageModal');
  const closeImageModal = document.getElementById('closeImageModal');
  const modalImage = document.getElementById('modalImage');
  const confirmModal = document.getElementById('confirmModal');
  const confirmDeleteBtn = document.getElementById('confirmDelete');
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  const confirmMessage = document.getElementById('confirmMessage');

  let deleteMode = false;
  let photoToDelete = null;
  let currentImageIndex = -1;
  let allImages = [];
  const preloadedImages = {}; // Cache for preloaded images

  // Fetch the list of image filenames and render them into the gallery.
  async function loadGallery() {
    try {
      // Clear preload cache when reloading gallery
      Object.keys(preloadedImages).forEach(key => delete preloadedImages[key]);
      
      const response = await fetch(`${prefix}/api/photos?meta=1`);
      if (!response.ok) {
        throw new Error('Failed to fetch photos');
      }
      const payload = await response.json();
      galleryEl.innerHTML = '';
      // Support two payload shapes:
      // 1) ["file1.jpg", ...]
      // 2) [{ original: "file1.jpg", thumb: "file1.thumb.jpg" | null, date_taken?: string }, ...]
      const items = Array.isArray(payload)
        ? (typeof payload[0] === 'string' || payload.length === 0
            ? payload.map(p => ({ original: p, thumb: null, date_taken: null }))
            : payload)
        : [];
      
      allImages = []; // Reset images array
      let lastMonthYear = null;
      
      items.forEach((item, index) => {
        const original = item && typeof item.original === 'string' ? item.original : String(item);
        const thumb = item && typeof item.thumb === 'string' ? item.thumb : null;
        const dateTaken = item && typeof item.date_taken === 'string' ? item.date_taken : null;
        
        // Format date as DD/MM/YYYY
        let dateLabel = '';
        let photoDate = null;
        if (dateTaken) {
          photoDate = new Date(dateTaken);
          // Validate that the date is valid
          if (!isNaN(photoDate.getTime())) {
            const day = String(photoDate.getDate()).padStart(2, '0');
            const month = String(photoDate.getMonth() + 1).padStart(2, '0');
            const year = photoDate.getFullYear();
            dateLabel = `${day}/${month}/${year}`;
          } else {
            // Invalid date, reset photoDate to null
            photoDate = null;
          }
        }

        // Insert month/year divider if month changed
        if (photoDate) {
          const monthYear = `${photoDate.getFullYear()}-${photoDate.getMonth()}`;
          if (monthYear !== lastMonthYear) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                'July', 'August', 'September', 'October', 'November', 'December'];
            const divider = document.createElement('div');
            divider.className = 'month-divider';
            divider.textContent = `${monthNames[photoDate.getMonth()]} - ${photoDate.getFullYear()}`;
            galleryEl.appendChild(divider);
            lastMonthYear = monthYear;
          }
        }

        const figure = document.createElement('figure');
        figure.className = 'photo-item';
        figure.dataset.filename = original;

        const img = document.createElement('img');
        // Prefer serving thumbnails; if API only returned originals, we can also
        // request /files/thumbs by original name thanks to server-side mapping.
        img.src = thumb
          ? `${prefix}/files/thumbs/${encodeURIComponent(thumb)}`
          : `${prefix}/files/thumbs/${encodeURIComponent(original)}`;
        img.alt = original;
        img.loading = 'lazy';
        img.tabIndex = 0;
        if (dateLabel) {
          img.title = dateLabel;
          img.setAttribute('aria-label', `Photo taken ${dateLabel}`);
          img.dataset.dateTaken = dateTaken;
        }
        // If the thumb 404s for some reason, fall back to original
        img.onerror = () => {
          if (img.src.includes('/files/thumbs/')) {
            img.onerror = null;
            img.src = `${prefix}/files/${encodeURIComponent(original)}`;
          }
        };
        // Open full original in lightbox
        const originalUrl = `${prefix}/files/${encodeURIComponent(original)}`;
        img.addEventListener('click', () => openImageModal(originalUrl, img.alt, index));
        img.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            openImageModal(originalUrl, img.alt, index);
          }
        });

        const caption = document.createElement('figcaption');
        caption.className = 'caption';
        caption.textContent = dateLabel || 'Unknown';

        // Delete button (only visible in delete mode)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<svg class="icon-delete" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><path d="M10 11v6m4-6v6"/></svg>';
        deleteBtn.title = 'Delete photo';
        deleteBtn.setAttribute('aria-label', 'Delete photo');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showConfirmModal(original, dateLabel || 'Unknown');
        });

        figure.appendChild(img);
        figure.appendChild(caption);
        figure.appendChild(deleteBtn);
        galleryEl.appendChild(figure);
        
        // Track image for navigation
        allImages.push({
          original: original,
          url: `${prefix}/files/${encodeURIComponent(original)}`,
          alt: original
        });
      });
    } catch (err) {
      showToast(err.message || 'Error loading gallery', true);
    }
  }

  // Display a temporary toast message. Errors are shown in red.
  function showToast(message, isError = false) {
    toastEl.textContent = message;
    if (isError) {
      toastEl.classList.add('error');
    } else {
      toastEl.classList.remove('error');
    }
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
    }, 3000);
  }

  // Toggle delete mode
  function toggleDeleteMode() {
    deleteMode = !deleteMode;
    document.body.classList.toggle('delete-mode', deleteMode);
    deleteToggle.classList.toggle('active', deleteMode);
    if (deleteMode) {
      deleteToggle.setAttribute('aria-label', 'Cancel delete mode');
      deleteToggle.setAttribute('title', 'Cancel delete mode');
    } else {
      deleteToggle.setAttribute('aria-label', 'Delete mode');
      deleteToggle.setAttribute('title', 'Toggle delete mode');
    }
  }

  // Show confirmation modal
  function showConfirmModal(filename, dateLabel) {
    photoToDelete = filename;
    confirmMessage.textContent = `Delete photo from ${dateLabel}?`;
    confirmModal.classList.remove('hidden');
    confirmModal.setAttribute('aria-hidden', 'false');
    confirmDeleteBtn.focus();
  }

  // Hide confirmation modal
  function closeConfirmModal() {
    photoToDelete = null;
    confirmModal.classList.add('hidden');
    confirmModal.setAttribute('aria-hidden', 'true');
  }

  // Delete photo
  async function deletePhoto() {
    if (!photoToDelete) return;

    const tokenInput = document.getElementById('token');
    let token = tokenInput ? tokenInput.value.trim() : '';
    
    // If token input is empty, guide user to enter token in the upload form
    if (!token) {
      showToast('Enter your upload token in the upload form before deleting photos', true);
      if (modalEl) {
        modalEl.classList.remove('hidden');
        modalEl.setAttribute('aria-hidden', 'false');
      }
      if (tokenInput) {
        tokenInput.focus();
      }
      closeConfirmModal();
      return;
    }

    try {
      const response = await fetch(`${prefix}/api/photos/${encodeURIComponent(photoToDelete)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });

      if (!response.ok) {
        let message = 'Delete failed';
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const errorBody = await response.json();
            if (errorBody && typeof errorBody.error === 'string' && errorBody.error.trim()) {
              message = errorBody.error;
            }
          } else {
            const text = await response.text();
            if (text && text.trim()) {
              message = text;
            }
          }
        } catch (parseErr) {
          // Ignore parsing errors and fall back to default message
        }
        throw new Error(message);
      }

      const result = await response.json();
      
      // Use API response flags to provide more specific feedback
      if (result && result.photo_deleted && result.thumbnail_deleted) {
        showToast('Photo deleted successfully', false);
      } else if (result && result.photo_deleted && result.thumbnail_deleted === false) {
        showToast('Photo deleted, but the thumbnail could not be deleted.', false);
        // Log details for debugging/monitoring partial failures
        console.warn('Thumbnail deletion failed for photo:', photoToDelete, result);
      } else if (result && result.photo_deleted) {
        // Fallback for unexpected combinations of flags
        showToast('Photo deleted (thumbnail status unknown).', false);
        console.warn('Unexpected delete response for photo:', photoToDelete, result);
      } else {
        // If we reach here with ok=true but no photo_deleted flag, keep generic success
        showToast('Photo deleted successfully', false);
      }
      
      closeConfirmModal();
      
      // Remove photo from gallery with animation
      const safeFilename = (window.CSS && typeof window.CSS.escape === 'function')
        ? window.CSS.escape(photoToDelete)
        : photoToDelete;
      const photoItem = document.querySelector(`.photo-item[data-filename="${safeFilename}"]`);
      if (photoItem) {
        photoItem.style.opacity = '0';
        photoItem.style.transform = 'scale(0.8)';
        setTimeout(() => {
          // Check if the currently displayed image in modal is the deleted photo
          if (imageModal.getAttribute('aria-hidden') === 'false' && 
              currentImageIndex >= 0 && 
              allImages[currentImageIndex] && 
              allImages[currentImageIndex].original === photoToDelete) {
            // Close the modal if viewing the deleted photo
            closeImageModalFunc();
          }
          loadGallery();
        }, 300);
      } else {
        // Check if viewing deleted photo even if not found in DOM
        if (imageModal.getAttribute('aria-hidden') === 'false' && 
            currentImageIndex >= 0 && 
            allImages[currentImageIndex] && 
            allImages[currentImageIndex].original === photoToDelete) {
          closeImageModalFunc();
        }
        loadGallery();
      }
    } catch (err) {
      showToast(err.message || 'Error deleting photo', true);
      closeConfirmModal();
    }
  }

  function openModal() {
    modalEl.classList.remove('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
    document.getElementById('token').focus();
  }

  function closeModalFunc() {
    modalEl.classList.add('hidden');
    modalEl.setAttribute('aria-hidden', 'true');
    uploadForm.reset();
  }

  // Open image modal with the clicked image
  function openImageModal(src, alt, index = -1) {
    currentImageIndex = index;
    modalImage.src = src;
    modalImage.alt = alt || 'Preview';
    imageModal.classList.remove('hidden');
    imageModal.setAttribute('aria-hidden', 'false');
    closeImageModal.focus();
    updateNavButtons();
    preloadAdjacentImages();
  }

  // Update navigation buttons visibility
  function updateNavButtons() {
    const prevBtn = document.getElementById('prevImage');
    const nextBtn = document.getElementById('nextImage');
    if (prevBtn && nextBtn) {
      prevBtn.style.display = currentImageIndex > 0 ? 'flex' : 'none';
      nextBtn.style.display = currentImageIndex < allImages.length - 1 ? 'flex' : 'none';
    }
  }

  // Preload adjacent images for smoother transitions
  function preloadAdjacentImages() {
    const urlsToPreload = [];
    
    // Preload previous image
    if (currentImageIndex > 0) {
      const prevUrl = allImages[currentImageIndex - 1].url;
      if (!preloadedImages[prevUrl]) {
        urlsToPreload.push(prevUrl);
      }
    }
    
    // Preload next image
    if (currentImageIndex < allImages.length - 1) {
      const nextUrl = allImages[currentImageIndex + 1].url;
      if (!preloadedImages[nextUrl]) {
        urlsToPreload.push(nextUrl);
      }
    }
    
    // Load images in background
    urlsToPreload.forEach(url => {
      const img = new Image();
      img.onload = () => {
        preloadedImages[url] = true;
      };
      img.onerror = () => {
        // Silently ignore preload errors
      };
      img.src = url;
    });
  }

  // Navigate to previous image
  function showPreviousImage() {
    if (currentImageIndex > 0) {
      currentImageIndex--;
      const img = allImages[currentImageIndex];
      modalImage.src = img.url;
      modalImage.alt = img.alt;
      updateNavButtons();
      preloadAdjacentImages();
    }
  }

  // Navigate to next image
  function showNextImage() {
    if (currentImageIndex < allImages.length - 1) {
      currentImageIndex++;
      const img = allImages[currentImageIndex];
      modalImage.src = img.url;
      modalImage.alt = img.alt;
      updateNavButtons();
      preloadAdjacentImages();
    }
  }

  // Close image modal
  function closeImageModalFunc() {
    imageModal.classList.add('hidden');
    imageModal.setAttribute('aria-hidden', 'true');
    modalImage.src = '';
  }

  // Show modal on upload button click
  uploadButton.addEventListener('click', () => {
    openModal();
  });

  // Delete mode toggle
  deleteToggle.addEventListener('click', () => {
    toggleDeleteMode();
  });

  // Hide modal on close and cancel click
  if (closeModal) {
    closeModal.addEventListener('click', closeModalFunc);
  }

  cancelUpload.addEventListener('click', () => {
    closeModalFunc();
  });

  // Handle form submission for file upload
  uploadForm.addEventListener('submit', event => {
    event.preventDefault();
    const submitBtn = event.submitter || event.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    
    const tokenInput = document.getElementById('token');
    const fileInput = document.getElementById('photo');
    const token = tokenInput.value.trim();
    const files = Array.from(fileInput.files || []);
    if (!files.length) {
      showToast('Please select image(s) to upload', true);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    const formData = new FormData();
    for (const f of files) {
      formData.append('photo', f);
    }
    fetch(`${prefix}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      body: formData
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => { throw err; });
        }
        return response.json();
      })
      .then((result) => {
        if (result && result.success) {
          const uploaded = (result.items || []).length;
          const failed = (result.errors || []).length;
          let msg = `Uploaded ${uploaded}`;
          if (failed) msg += `, ${failed} failed`;
          showToast(msg);
        } else {
          const message = result && result.error ? result.error : 'Upload failed';
          showToast(message, true);
        }
        closeModalFunc();
        loadGallery();
      })
      .catch(error => {
        const message = error && error.error ? error.error : 'Upload failed';
        showToast(message, true);
      })
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
  });

  // Confirm delete button
  confirmDeleteBtn.addEventListener('click', () => {
    deletePhoto();
  });

  // Cancel delete button
  cancelDeleteBtn.addEventListener('click', () => {
    closeConfirmModal();
  });
  
  // Close confirmation modal on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Esc') {
      // Only close if the confirmation modal is currently visible
      if (confirmModal && confirmModal.getAttribute('aria-hidden') === 'false') {
        closeConfirmModal();
      }
    }
  });

  // Close confirmation modal when clicking outside the modal content
  if (confirmModal) {
    confirmModal.addEventListener('click', (event) => {
      // Close when clicking the backdrop (not the modal content)
      if (event.target === confirmModal) {
        closeConfirmModal();
      }
    });
  }

  // Close image modal on close button click
  closeImageModal.addEventListener('click', closeImageModalFunc);

  // Close image modal on click outside image
  imageModal.addEventListener('click', e => {
    if (e.target === imageModal) {
      closeImageModalFunc();
    }
  });

  // Image navigation with arrow keys
  document.addEventListener('keydown', event => {
    if (imageModal.getAttribute('aria-hidden') === 'false') {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPreviousImage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNextImage();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeImageModalFunc();
      }
    }
  });

  // Navigation button click handlers
  const prevBtn = document.getElementById('prevImage');
  const nextBtn = document.getElementById('nextImage');
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showPreviousImage();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showNextImage();
    });
  }

  // Global keyboard shortcuts: press 'u' to open the upload modal and 'Escape' to close it
  document.addEventListener('keydown', event => {
    if ((event.key === 'u' || event.key === 'U') && modalEl.getAttribute('aria-hidden') === 'true') {
      event.preventDefault();
      openModal();
    } else if (event.key === 'Escape' && modalEl.getAttribute('aria-hidden') === 'false') {
      event.preventDefault();
      closeModalFunc();
    }
  });

  // Initial load
  loadGallery();
});
